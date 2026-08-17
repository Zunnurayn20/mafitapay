// Restore the column DEFAULTs that the SQLite -> PostgreSQL import dropped.
//
// scripts/migrate-sqlite-to-postgres.mjs copied each column's NOT NULL but never read its
// dflt_value, so every `NOT NULL DEFAULT x` column arrived in Postgres as a bare `NOT NULL`. Any
// INSERT that omitted such a column then wrote NULL and failed the constraint -- which is what broke
// the Flutterwave webhook on provider_events.retry_count.
//
// Rather than hardcode a list, this diffs the two schemas: for every column where SQLite has a
// default and Postgres does not, it emits `ALTER TABLE ... ALTER COLUMN ... SET DEFAULT <value>`.
// That is metadata-only in Postgres -- no table rewrite, no lock of consequence, and idempotent.
//
// Dry run (prints, changes nothing):
//   node scripts/restore-postgres-defaults.mjs
// Apply:
//   node scripts/restore-postgres-defaults.mjs --apply
//
// Connection string comes from DATABASE_PUBLIC_URL, POSTGRES_URL, or DATABASE_URL. On Railway, grab
// DATABASE_PUBLIC_URL from the Postgres service's Variables tab (DATABASE_URL is private-network
// only and will not resolve from your laptop).
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const apply = process.argv.includes('--apply')
const sqlitePath = resolve(process.argv.find(arg => arg.endsWith('.db')) || 'data/app.db')
const connectionString = process.env.DATABASE_PUBLIC_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL

if (!existsSync(sqlitePath)) throw new Error(`SQLite schema reference not found: ${sqlitePath}`)
if (!connectionString) {
  throw new Error('Set DATABASE_PUBLIC_URL (Railway: Postgres service -> Variables) before running this.')
}

const sqlite = new DatabaseSync(sqlitePath, { readOnly: true })
const client = new pg.Client({
  connectionString,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
})
await client.connect()

try {
  // What SQLite says each column's default should be.
  const intended = new Map()
  const tables = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name
  `).all().map(row => row.name)

  for (const table of tables) {
    for (const column of sqlite.prepare(`PRAGMA table_info("${table.replaceAll('"', '""')}")`).all()) {
      if (column.dflt_value === null || column.dflt_value === undefined) continue
      intended.set(`${table}.${column.name}`, { table, column: column.name, value: column.dflt_value })
    }
  }

  // What Postgres actually has.
  const live = await client.query(`
    SELECT table_name, column_name, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `)
  const liveByKey = new Map(
    live.rows.map(row => [`${row.table_name}.${row.column_name}`, row])
  )

  const missing = []
  for (const [key, want] of intended) {
    const actual = liveByKey.get(key)
    if (!actual) continue                          // table/column not in Postgres; nothing to do
    if (actual.column_default !== null) continue   // already has a default
    missing.push({ ...want, notNull: actual.is_nullable === 'NO' })
  }

  if (missing.length === 0) {
    console.log('No missing defaults. Postgres matches the SQLite schema.')
  } else {
    // NOT NULL columns are the ones that actually break inserts; list them first.
    missing.sort((left, right) => Number(right.notNull) - Number(left.notNull))
    console.log(`${missing.length} column(s) lost their DEFAULT in Postgres`)
    console.log(`(${missing.filter(item => item.notNull).length} of them NOT NULL — those are the ones that break INSERTs)\n`)
    for (const item of missing) {
      const sql = `ALTER TABLE "${item.table}" ALTER COLUMN "${item.column}" SET DEFAULT ${item.value};`
      console.log(`${item.notNull ? 'NOT NULL  ' : 'nullable  '}${sql}`)
      if (apply) await client.query(sql)
    }
    console.log(apply ? '\nApplied.' : '\nDry run — nothing changed. Re-run with --apply to execute.')
  }
} finally {
  sqlite.close()
  await client.end()
}
