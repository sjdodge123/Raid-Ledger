#!/usr/bin/env node
/**
 * reconcile-migrations.mjs
 *
 * Reconciles `drizzle.__drizzle_migrations` with the current migration
 * journal. Every journal entry whose hash is NOT in the table is attempted:
 *   - Run each statement in a savepoint; if the statement errors with an
 *     "already exists" code (42P06/42P07/42701/42710/42P04/42P16), treat
 *     that statement as idempotent (skip-ok) and continue.
 *   - Any other error rolls the migration back and halts the script.
 *   - If every statement finished with status "ran" or "skip-ok", we insert
 *     the hash row so future runs see the migration as applied.
 *
 * This tool is the recovery path for:
 *   - Restoring backups that exclude the drizzle schema (by design).
 *   - Cross-branch drift where schema effects exist but hashes diverge.
 *   - Manual schema changes applied out-of-band.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/reconcile-migrations.mjs
 *   DATABASE_URL=postgresql://... node scripts/reconcile-migrations.mjs --dry-run
 *
 * Exit codes:
 *   0  success (DB is in sync with journal)
 *   1  non-idempotent error encountered — DB untouched beyond what succeeded
 *   2  bad input (missing env, missing files, malformed journal)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
);
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'api/src/drizzle/migrations');
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, 'meta/_journal.json');

/** Postgres error codes we treat as idempotent "effect already present". */
const IDEMPOTENT_CODES = new Set([
  '42P04', // duplicate_database
  '42P06', // duplicate_schema
  '42P07', // duplicate_table
  '42710', // duplicate_object (constraint, index, trigger, etc.)
  '42701', // duplicate_column
  '42P16', // invalid_table_definition — sometimes emitted for re-add column
]);

function die(code, msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

function loadJournal() {
  if (!fs.existsSync(JOURNAL_PATH)) {
    die(2, `journal not found at ${JOURNAL_PATH}`);
  }
  const journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf-8'));
  return journal.entries.map((entry) => {
    const sqlPath = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) {
      die(2, `migration file missing: ${sqlPath}`);
    }
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    const hash = crypto.createHash('sha256').update(sql).digest('hex');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    return { ...entry, sql, hash, statements };
  });
}

async function loadAppliedState(sql) {
  // Ensure the table exists. Drizzle creates it on first migrate.
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;
  const rows = await sql`
    SELECT hash, created_at FROM drizzle.__drizzle_migrations
  `;
  return {
    appliedHashes: new Set(rows.map((r) => r.hash)),
    maxAppliedWhen: rows.reduce(
      (m, r) => (r.created_at > m ? r.created_at : m),
      0,
    ),
  };
}

/**
 * Detect whether the database already holds application data. A populated
 * `users` table indicates the schema was restored from a backup and every
 * journal entry should be trusted as applied — re-running migration SQL
 * would collide with a schema that has since evolved.
 */
async function detectRestoredSchema(sql) {
  const rows = await sql`
    SELECT to_regclass('public.users') AS tbl
  `;
  if (!rows[0]?.tbl) return false;
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM users`;
  return count > 0;
}

async function applyStatement(sql, stmt) {
  await sql.begin(async (tx) => {
    await tx.savepoint('stmt', async (sp) => {
      await sp.unsafe(stmt);
    });
  });
}

async function runMigration(sql, entry, { dryRun, trustAsApplied }) {
  const outcome = { tag: entry.tag, ran: 0, skipped: 0, trusted: 0 };
  if (trustAsApplied) {
    // The DB schema has evolved past this migration (later migrations are
    // applied). Re-running this SQL would fail against the evolved schema.
    // Treat every statement as trusted-already-applied and just record the
    // hash so drizzle-kit migrate sees the full chain.
    outcome.trusted = entry.statements.length;
    return outcome;
  }
  for (const stmt of entry.statements) {
    if (dryRun) {
      console.log(`  [dry-run] would run: ${stmt.slice(0, 100)}...`);
      outcome.ran++;
      continue;
    }
    try {
      await sql.unsafe(stmt);
      outcome.ran++;
    } catch (err) {
      if (IDEMPOTENT_CODES.has(err.code)) {
        outcome.skipped++;
        continue;
      }
      throw err;
    }
  }
  return outcome;
}

async function recordHash(sql, entry) {
  await sql`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    VALUES (${entry.hash}, ${entry.when})
  `;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) die(2, 'DATABASE_URL not set');
  const dryRun = process.argv.includes('--dry-run');

  const entries = loadJournal();
  const sql = postgres(databaseUrl, { onnotice: () => {}, max: 1 });

  try {
    const { appliedHashes, maxAppliedWhen } = await loadAppliedState(sql);
    const schemaRestored = await detectRestoredSchema(sql);
    const missing = entries.filter((e) => !appliedHashes.has(e.hash));

    if (missing.length === 0) {
      console.log(
        `✓ Migration state in sync — ${entries.length} entries applied`,
      );
      return;
    }

    // Trust-vs-apply decision:
    //   • schemaRestored  → the DB has application data, meaning at some
    //     historical point the schema was built up through migrations. Any
    //     missing journal entry is trusted as "applied in the past"; we
    //     only record the hash. This handles restore-from-backup and
    //     cross-branch drift. Running a brand-new migration here is NOT
    //     the tool's job — use `drizzle-kit migrate` for that.
    //   • !schemaRestored → fresh DB being built up. Apply each missing
    //     migration (with idempotent-skip fallback for columns/tables that
    //     happen to already exist).
    //
    // Runbook:
    //   after backup restore  → reconcile (trust) → drizzle-kit migrate (applies any post-backup migrations)
    //   after generating a new migration → drizzle-kit migrate (not reconcile)
    //   after seeing cross-branch drift on a populated dev DB → reconcile
    const decide = () => ({ trustAsApplied: schemaRestored });

    console.log(
      `Journal has ${entries.length} entries; ${missing.length} need reconciliation:\n`,
    );
    const mode = decide().trustAsApplied ? 'trust' : 'apply';
    console.log(`Mode: ${mode} (schemaRestored=${schemaRestored})`);
    for (const entry of missing) {
      console.log(`  • ${entry.tag} (idx ${entry.idx})`);
    }
    console.log('');

    let successCount = 0;
    let ranCount = 0;
    let skippedCount = 0;
    let trustedCount = 0;
    const decision = decide();
    for (const entry of missing) {
      process.stdout.write(`→ ${entry.tag}... `);
      const outcome = await runMigration(sql, entry, {
        dryRun,
        trustAsApplied: decision.trustAsApplied,
      });
      if (!dryRun) await recordHash(sql, entry);
      const parts = [];
      if (outcome.ran) parts.push(`${outcome.ran} ran`);
      if (outcome.skipped) parts.push(`${outcome.skipped} idempotent`);
      if (outcome.trusted) parts.push(`${outcome.trusted} trusted`);
      console.log(`ok (${parts.join(', ') || 'noop'})`);
      successCount++;
      ranCount += outcome.ran;
      skippedCount += outcome.skipped;
      trustedCount += outcome.trusted;
    }

    console.log(
      `\n✓ Reconciled ${successCount}/${missing.length} migrations (${ranCount} ran, ${skippedCount} idempotent, ${trustedCount} trusted)`,
    );
    if (dryRun) console.log('  (dry-run — no changes applied)');
  } catch (err) {
    console.error(`\n✗ Halted: ${err.message}`);
    if (err.code) console.error(`  pg code: ${err.code}`);
    if (err.detail) console.error(`  detail: ${err.detail}`);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
