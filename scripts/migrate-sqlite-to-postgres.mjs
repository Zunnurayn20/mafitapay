import { DatabaseSync } from 'node:sqlite'
import { Client } from 'pg'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const schemaOnly = args.includes('--schema-only')
const sourceArgument = args.find(argument => argument !== '--schema-only')
const sourcePath = resolve(sourceArgument || '.migration-backups/production-app-20260812.db')
// Prefer the explicitly scoped Supabase migration URL so a local DATABASE_URL
// for another environment cannot accidentally become the migration target.
const connectionString = schemaOnly
  ? process.env.SUPABASE_MIGRATION_URL
  : process.env.SUPABASE_MIGRATION_URL || process.env.DATABASE_PUBLIC_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL

if (!existsSync(sourcePath)) throw new Error(`SQLite source not found: ${sourcePath}`)
if (!connectionString) {
  throw new Error(schemaOnly
    ? 'SUPABASE_MIGRATION_URL is required for schema-only setup.'
    : 'SUPABASE_MIGRATION_URL, DATABASE_PUBLIC_URL, DATABASE_URL, or POSTGRES_URL is required.')
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

/**
 * Render a column's DEFAULT for PostgreSQL, or '' when it has none.
 *
 * Carrying this across matters as much as NOT NULL does. Dropping it while keeping NOT NULL turns a
 * SQLite `INTEGER NOT NULL DEFAULT 0` into a bare `INTEGER NOT NULL`, so every INSERT that relied on
 * the default -- which is most of them, since that is the point of a default -- starts failing with
 * `null value in column ... violates not-null constraint`. That is exactly how the Flutterwave
 * webhook broke: `provider_events.retry_count` lost its default here, so recording an incoming event
 * threw, the handler answered 404, and deposits went uncredited while payouts stalled at `pending`.
 *
 * `dflt_value` from PRAGMA table_info is already SQL text (`0`, `'active'`, `NULL`), so it is emitted
 * verbatim rather than re-quoted.
 */
function postgresDefault(column) {
  const value = column.dflt_value
  if (value === null || value === undefined) return ''
  return ` DEFAULT ${value}`
}

function postgresType(sqliteType = '') {
  const type = sqliteType.toUpperCase()
  if (type.includes('INT')) return 'BIGINT'
  if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB')) return 'DOUBLE PRECISION'
  if (type.includes('BLOB')) return 'BYTEA'
  return 'TEXT'
}

const sqlite = new DatabaseSync(sourcePath, { readOnly: true })
const client = new Client({
  connectionString,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
})

const tableNames = sqlite.prepare(`
  SELECT name FROM sqlite_master
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`).all().map(row => row.name)

await client.connect()

try {
  if (schemaOnly) {
    const existing = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = current_schema()
    `)
    const existingNames = new Set(existing.rows.map(row => row.tablename))
    const conflicts = tableNames.filter(table => existingNames.has(table))
    if (conflicts.length > 0) {
      throw new Error(`Schema-only setup stopped: target already contains MafitaPay tables: ${conflicts.join(', ')}`)
    }
  }

  await client.query('BEGIN')
  const schemaOnlyConstraints = []

  for (const table of tableNames) {
    const columns = sqlite.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all()
    const primaryKeyColumns = columns
      .filter(column => column.pk)
      .sort((left, right) => Number(left.pk) - Number(right.pk))
      .map(column => column.name)
    const definitions = columns.map(column => {
      const required = column.notnull ? ' NOT NULL' : ''
      return `${quoteIdentifier(column.name)} ${postgresType(column.type)}${postgresDefault(column)}${required}`
    })
    if (primaryKeyColumns.length > 0) {
      definitions.push(`PRIMARY KEY (${primaryKeyColumns.map(quoteIdentifier).join(', ')})`)
    }

    if (!schemaOnly) {
      await client.query(`DROP TABLE IF EXISTS ${quoteIdentifier(table)} CASCADE`)
    }
    await client.query(`CREATE TABLE ${quoteIdentifier(table)} (${definitions.join(', ')})`)

    // Schema-only setup must not read or transfer application records.
    const rows = schemaOnly ? [] : sqlite.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all()
    if (rows.length > 0) {
      const names = columns.map(column => column.name)
      const placeholders = names.map((_, index) => `$${index + 1}`).join(', ')
      const insertSql = `INSERT INTO ${quoteIdentifier(table)} (${names.map(quoteIdentifier).join(', ')}) VALUES (${placeholders})`
      for (const row of rows) {
        await client.query(insertSql, names.map(name => row[name]))
      }
    }

    const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(table)}`)
    const imported = result.rows[0].count
    if (imported !== rows.length) {
      throw new Error(`${table}: imported ${imported} rows but expected ${rows.length}`)
    }

    const indexes = sqlite.prepare(`PRAGMA index_list(${quoteIdentifier(table)})`).all()
    for (const index of indexes) {
      if (!index.unique || String(index.origin) === 'pk') continue
      const indexColumns = sqlite.prepare(`PRAGMA index_info(${quoteIdentifier(index.name)})`).all()
        .sort((left, right) => Number(left.seqno) - Number(right.seqno))
        .map(column => column.name)
      if (indexColumns.length === 0) continue
      const postgresIndexName = `ux_${table}_${indexColumns.join('_')}`.replaceAll(/[^a-zA-Z0-9_]/g, '_')
      await client.query(`CREATE UNIQUE INDEX ${quoteIdentifier(postgresIndexName)} ON ${quoteIdentifier(table)} (${indexColumns.map(quoteIdentifier).join(', ')})`)
    }

    if (schemaOnly) {
      const foreignKeys = sqlite.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`).all()
      const groups = new Map()
      for (const foreignKey of foreignKeys) {
        const group = groups.get(foreignKey.id) ?? []
        group.push(foreignKey)
        groups.set(foreignKey.id, group)
      }
      for (const [id, group] of groups) {
        group.sort((left, right) => Number(left.seq) - Number(right.seq))
        const constraintName = `fk_${table}_${id}`.replaceAll(/[^a-zA-Z0-9_]/g, '_').slice(0, 63)
        const sourceColumns = group.map(foreignKey => quoteIdentifier(foreignKey.from)).join(', ')
        const targetColumns = group.map(foreignKey => foreignKey.to ? quoteIdentifier(foreignKey.to) : null)
        const targetColumnSql = targetColumns.every(Boolean) ? ` (${targetColumns.join(', ')})` : ''
        const onUpdate = String(group[0].on_update).toUpperCase()
        const onDelete = String(group[0].on_delete).toUpperCase()
        const updateSql = onUpdate === 'NO ACTION' ? '' : ` ON UPDATE ${onUpdate}`
        const deleteSql = onDelete === 'NO ACTION' ? '' : ` ON DELETE ${onDelete}`
        schemaOnlyConstraints.push(
          `ALTER TABLE ${quoteIdentifier(table)} ADD CONSTRAINT ${quoteIdentifier(constraintName)} FOREIGN KEY (${sourceColumns}) REFERENCES ${quoteIdentifier(group[0].table)}${targetColumnSql}${updateSql}${deleteSql}`,
        )
      }
    }
    console.log(schemaOnly ? `${table}: schema created` : `${table}: ${imported}`)
  }

  // Add foreign keys after all tables exist so references to later-sorted tables work.
  for (const statement of schemaOnlyConstraints) {
    await client.query(statement)
  }

  await client.query('COMMIT')
  console.log(schemaOnly
    ? `Schema setup complete: ${tableNames.length} tables created from ${sourcePath}; no rows were copied.`
    : `Migration complete: ${tableNames.length} tables imported from ${sourcePath}.`)
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  throw error
} finally {
  sqlite.close()
  await client.end()
}
