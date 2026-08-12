import { DatabaseSync } from 'node:sqlite'
import { Client } from 'pg'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const sourcePath = resolve(process.argv[2] || '.migration-backups/production-app-20260812.db')
// Railway exposes DATABASE_URL on its private network and DATABASE_PUBLIC_URL for local tools.
// Prefer the latter for this operator-run importer; the deployed app will use DATABASE_URL.
const connectionString = process.env.DATABASE_PUBLIC_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL

if (!existsSync(sourcePath)) throw new Error(`SQLite source not found: ${sourcePath}`)
if (!connectionString) throw new Error('DATABASE_PUBLIC_URL, DATABASE_URL, or POSTGRES_URL is required.')

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
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
  await client.query('BEGIN')

  for (const table of tableNames) {
    const columns = sqlite.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all()
    const primaryKeyColumns = columns
      .filter(column => column.pk)
      .sort((left, right) => Number(left.pk) - Number(right.pk))
      .map(column => column.name)
    const definitions = columns.map(column => {
      const required = column.notnull ? ' NOT NULL' : ''
      return `${quoteIdentifier(column.name)} ${postgresType(column.type)}${required}`
    })
    if (primaryKeyColumns.length > 0) {
      definitions.push(`PRIMARY KEY (${primaryKeyColumns.map(quoteIdentifier).join(', ')})`)
    }

    await client.query(`DROP TABLE IF EXISTS ${quoteIdentifier(table)} CASCADE`)
    await client.query(`CREATE TABLE ${quoteIdentifier(table)} (${definitions.join(', ')})`)

    const rows = sqlite.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all()
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
    console.log(`${table}: ${imported}`)
  }

  await client.query('COMMIT')
  console.log(`Migration complete: ${tableNames.length} tables imported from ${sourcePath}.`)
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  throw error
} finally {
  sqlite.close()
  await client.end()
}
