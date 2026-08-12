import { DatabaseSync } from 'node:sqlite'
import { Client } from 'pg'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const sourcePath = resolve(process.argv[2] || '/app/data/app.db')
const connectionString = process.env.DATABASE_URL

if (!existsSync(sourcePath)) throw new Error(`SQLite source not found: ${sourcePath}`)
if (!connectionString) throw new Error('DATABASE_URL is required.')

const sqlite = new DatabaseSync(sourcePath, { readOnly: true })
const postgres = new Client({ connectionString, ssl: false })

function sqliteSummary() {
  return {
    users: Number(sqlite.prepare('SELECT COUNT(*) AS value FROM users').get().value),
    transactions: Number(sqlite.prepare('SELECT COUNT(*) AS value FROM transactions').get().value),
    walletAvailable: Number(sqlite.prepare('SELECT COALESCE(SUM(balance), 0) AS value FROM wallets').get().value),
    ledgerAvailable: Number(sqlite.prepare("SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS value FROM ledger_entries WHERE COALESCE(asset, 'NGN') = 'NGN' AND account = 'available'").get().value),
    ledgerLocked: Number(sqlite.prepare("SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS value FROM ledger_entries WHERE COALESCE(asset, 'NGN') = 'NGN' AND account = 'locked'").get().value),
    cryptoAddresses: Number(sqlite.prepare('SELECT COUNT(*) AS value FROM crypto_deposit_addresses').get().value),
  }
}

async function postgresSummary() {
  const scalar = async sql => Number((await postgres.query(sql)).rows[0].value)
  return {
    users: await scalar('SELECT COUNT(*) AS value FROM users'),
    transactions: await scalar('SELECT COUNT(*) AS value FROM transactions'),
    walletAvailable: await scalar('SELECT COALESCE(SUM(balance), 0) AS value FROM wallets'),
    ledgerAvailable: await scalar("SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS value FROM ledger_entries WHERE COALESCE(asset, 'NGN') = 'NGN' AND account = 'available'"),
    ledgerLocked: await scalar("SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS value FROM ledger_entries WHERE COALESCE(asset, 'NGN') = 'NGN' AND account = 'locked'"),
    cryptoAddresses: await scalar('SELECT COUNT(*) AS value FROM crypto_deposit_addresses'),
  }
}

try {
  await postgres.connect()
  const source = sqliteSummary()
  const target = await postgresSummary()
  const mismatches = Object.keys(source).filter(key => {
    const left = source[key]
    const right = target[key]
    // Currency totals are compared at the NGN kobo precision used by the app.
    if (key.startsWith('wallet') || key.startsWith('ledger')) {
      return Math.round(left * 100) !== Math.round(right * 100)
    }
    return left !== right
  })
  console.log(JSON.stringify({ source, target, matched: mismatches.length === 0, mismatches }, null, 2))
  if (mismatches.length) process.exitCode = 1
} finally {
  sqlite.close()
  await postgres.end()
}
