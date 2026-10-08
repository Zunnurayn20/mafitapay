# MafitaPay Supabase proof of concept

This is a staged database trial, not a production migration checklist. MafitaPay already has a PostgreSQL data-access path, but its current default is local SQLite.

## Vercel function connection settings

Create a new Supabase project for MafitaPay. In Supabase's **Connect** panel, select **Transaction pooler** and use its full connection URI; do not construct the pooler host or username manually. Add these server-only Vercel environment variables:

```text
MAFITAPAY_DATABASE_DRIVER=postgres
DATABASE_URL=<Supabase transaction-pooler URI>
PGSSLMODE=require
MAFITAPAY_POSTGRES_POOL_MAX=1
```

Do not prefix the database URL with `NEXT_PUBLIC_`. The application pool is kept at one connection per warm function instance for serverless use. Transaction mode does not preserve session-level state, so avoid relying on session settings or session advisory locks.

## Before pointing the app at the project

1. Use a new, empty Supabase project for the first connection check.
2. Put the new project's direct connection URI (or session-pooler URI if direct IPv6 is unavailable) in the local, git-ignored `.env` as `SUPABASE_MIGRATION_URL`. Then provision only the schema from the local database file:

   ```powershell
   node --env-file=.env scripts/migrate-sqlite-to-postgres.mjs data/app.db --schema-only
   ```

   Schema-only mode refuses to replace existing MafitaPay tables and does not read or copy application rows. The regular importer remains destructive and copies every row; do not use it against a database containing data you need to keep.
3. PostgreSQL startup now avoids initializing SQLite and seeds only the built-in crypto, bill, network, and reward catalogs when those tables are empty. It does not seed users, wallets, or transactions. Run a focused serverless smoke check before deploying it.
4. Keep the existing MafitaPay deployment and database as the rollback source until the new deployment has passed those checks. OWO remains a separate project.

## Free-tier constraints

Supabase Free currently includes 500 MB of database space, but projects with low activity may be paused after seven days, and Free does not include downloadable automatic backups. Treat this as a proof of concept until the availability and backup tradeoffs are acceptable for the app. Vercel Hobby is limited to personal or non-commercial use under Vercel's terms; confirm MafitaPay's hosting plan is eligible before treating that hosting as a zero-cost production option.

References:

- [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Vercel Terms of Service](https://vercel.com/legal/terms)
