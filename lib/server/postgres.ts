import { Pool, type PoolClient, type QueryResultRow } from 'pg'

type SqlParam = string | number | boolean | null | Buffer | Date | bigint | undefined

declare global {
  // eslint-disable-next-line no-var
  var __mafitapayPostgresPool: Pool | undefined
}

function getConnectionString() {
  const value = process.env.DATABASE_URL?.trim()
  if (!value) throw new Error('DATABASE_URL is required when PostgreSQL is enabled.')
  return value
}

export function isPostgresEnabled() {
  return process.env.MAFITAPAY_DATABASE_DRIVER?.trim().toLowerCase() === 'postgres'
}

export function getPostgresPool() {
  if (!globalThis.__mafitapayPostgresPool) {
    globalThis.__mafitapayPostgresPool = new Pool({
      connectionString: getConnectionString(),
      // Railway's private service connection is TLS-free. Public URLs are TLS-enabled.
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
      max: Math.max(2, Number(process.env.MAFITAPAY_POSTGRES_POOL_MAX ?? 10) || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  }
  return globalThis.__mafitapayPostgresPool
}

/** Convert the SQLite positional placeholder syntax used by the legacy repository to Postgres. */
export function sqlitePlaceholdersToPostgres(sql: string) {
  let index = 0
  let quote: "'" | '"' | null = null
  let output = ''

  for (let cursor = 0; cursor < sql.length; cursor += 1) {
    const char = sql[cursor]
    if (quote) {
      output += char
      if (char === quote && sql[cursor + 1] === quote) {
        output += sql[cursor + 1]
        cursor += 1
      } else if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      output += char
      continue
    }
    if (char === '?') {
      index += 1
      output += `$${index}`
      continue
    }
    output += char
  }
  return output
}

function normalizeValue(value: SqlParam) {
  return value === undefined ? null : value
}

export async function queryPostgres<Row extends QueryResultRow = QueryResultRow>(sql: string, params: SqlParam[] = []) {
  return await getPostgresPool().query<Row>(sqlitePlaceholdersToPostgres(sql), params.map(normalizeValue))
}

export async function withPostgresTransaction<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await getPostgresPool().connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
