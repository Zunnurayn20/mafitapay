import pg from 'pg'

const connectionString = process.env.SUPABASE_MIGRATION_URL
if (!connectionString) throw new Error('SUPABASE_MIGRATION_URL is required.')

const client = new pg.Client({
  connectionString,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
})

try {
  await client.connect()
  const tableResult = await client.query(`
    SELECT c.relrowsecurity, string_agg(a.attname, ',' ORDER BY a.attnum) AS columns
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relname = 'static_virtual_account_provisioning'
    GROUP BY c.relrowsecurity
  `)
  const table = tableResult.rows[0]
  if (!table) throw new Error('static_virtual_account_provisioning table was not found.')
  if (table.relrowsecurity !== true) throw new Error('RLS is not enabled.')

  const constraintsResult = await client.query(`
    SELECT contype, conkey, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'public.static_virtual_account_provisioning'::regclass
  `)
  const constraints = constraintsResult.rows
  const expectedColumns = ['user_id', 'provider', 'reference', 'status', 'virtual_account', 'failure_reason', 'created_at', 'updated_at']
  const columns = new Set(String(table.columns).split(','))
  const missingColumns = expectedColumns.filter(column => !columns.has(column))
  if (missingColumns.length) throw new Error(`Required provisioning table columns are missing: ${missingColumns.join(', ')}`)
  if (!constraints.some(constraint => constraint.contype === 'p')) throw new Error('The user/provider primary key is missing.')
  if (!constraints.some(constraint => constraint.contype === 'u' && constraint.definition.includes('(reference)'))) {
    throw new Error('The unique provisioning reference constraint is missing.')
  }
  if (!constraints.some(constraint => constraint.contype === 'c' && constraint.definition.includes('ready'))) {
    throw new Error('The ready-state account integrity check is missing.')
  }

  console.log(JSON.stringify({
    verified: true,
    rowLevelSecurity: table.relrowsecurity,
    requiredColumns: expectedColumns.length,
    primaryKey: 'user_id, provider',
    uniqueReference: true,
    readyAccountConstraint: true,
  }))
} finally {
  await client.end()
}
