import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'

const migrationPath = process.argv[2]
if (!migrationPath) throw new Error('Pass a SQL migration file path.')
const verificationTable = process.argv[3] ?? 'privy_auth_links'
if (!/^[a-z][a-z0-9_]*$/.test(verificationTable)) throw new Error('Invalid verification table name.')

const connectionString = process.env.SUPABASE_MIGRATION_URL
if (!connectionString) throw new Error('SUPABASE_MIGRATION_URL is required.')

const sql = await readFile(resolve(migrationPath), 'utf8')
const client = new pg.Client({
  connectionString,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
})

await client.connect()
try {
  await client.query('BEGIN')
  await client.query(sql)
  await client.query('COMMIT')
  const verification = await client.query(`
    SELECT c.relrowsecurity AS rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = $1
  `, [verificationTable])
  if (verification.rows[0]?.rls_enabled !== true) {
    throw new Error(`${verificationTable} was created without row-level security enabled.`)
  }
  console.log(`Applied and verified ${migrationPath}; RLS is enabled on ${verificationTable}.`)
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  throw error
} finally {
  await client.end()
}
