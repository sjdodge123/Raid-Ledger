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
// RL_MIGRATIONS_DIR override exists so the regression test can point the
// reconciler at a throwaway fixture journal/migrations set instead of the
// real one. Defaults to the canonical in-repo location.
const MIGRATIONS_DIR =
  process.env.RL_MIGRATIONS_DIR ||
  path.join(REPO_ROOT, 'api/src/drizzle/migrations');
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

/**
 * Probe whether a migration's effect is already present WITHOUT mutating the
 * DB. Runs the migration's first DDL statement inside a transaction-scoped
 * savepoint and always rolls it back. We classify by the result:
 *
 *   - statement errors with an idempotent "already exists" code → the effect
 *     is genuinely present (e.g. `CREATE TABLE x` → 42P07). `exists: true`.
 *   - statement succeeds → the effect was NOT present (we just created it
 *     inside the savepoint, which we discard). `exists: false`.
 *   - statement errors with any other code → ambiguous; don't trust it.
 *     `exists: false` so the caller demotes to an actual run that surfaces
 *     the real error instead of silently recording a phantom hash row.
 *
 * Reuses the same savepoint pattern + IDEMPOTENT_CODES set as the apply path,
 * so the trust decision and the apply decision agree on what "already exists"
 * means.
 */
async function probeEffectExists(sql, stmt) {
  let sawError;
  try {
    await sql.begin(async (tx) => {
      try {
        await tx.savepoint('probe', async (sp) => {
          await sp.unsafe(stmt);
        });
      } catch (err) {
        sawError = err;
      }
      // Never persist the probe — fail the outer txn to force a rollback.
      throw new Error('__rl_probe_rollback__');
    });
  } catch (err) {
    if (err.message !== '__rl_probe_rollback__') sawError = err;
  }
  if (sawError) return { exists: IDEMPOTENT_CODES.has(sawError.code) };
  // Statement applied cleanly inside the savepoint → effect was absent.
  return { exists: false };
}

async function runMigration(sql, entry, { dryRun, trustAsApplied }) {
  const outcome = { tag: entry.tag, ran: 0, skipped: 0, trusted: 0 };
  if (trustAsApplied) {
    // The DB has application data, so the schema was historically built up
    // through migrations — BUT we must not blindly trust that THIS migration's
    // effect is present (the DB may be merely out of date, e.g. restored from
    // an older backup missing newer migrations). Probe EVERY statement's effect,
    // not just the first: a migration can be PARTIALLY applied (an early
    // CREATE TABLE landed, a later one didn't — a backup taken mid-migration, a
    // historical crash between statement-breakpoints, or cross-branch drift).
    //   • all statements' effects present → safe to trust; record the hash only.
    //   • any one absent → short-circuit and demote to a real run so the missing
    //     schema actually lands instead of being silently marked applied
    //     (ROK-1319 caught the first-statement case; ROK-1413 closes the
    //     later-statement hole the shallow first-statement-only probe left open).
    // An empty statement list has no DDL to verify → nothing to run, trust the
    // hash (the loop leaves allPresent=true).
    //
    // ONLY DDL statements are probed. The probe's signal is "does re-running
    // this statement error with an already-exists code?" — that only works for
    // CREATE/ALTER/DROP. A DML statement (UPDATE/INSERT/DELETE backfill) runs
    // CLEANLY on a populated DB, which the probe would misread as "effect
    // absent" and demote the whole migration to a real re-run — re-applying
    // data transformations (Codex P1, fix-batch 2026-07-17-b). Non-DDL
    // statements are unverifiable in trust mode → they don't influence the
    // decision (trust-mode default: a populated DB is presumed historically
    // migrated).
    let allPresent = true;
    for (const stmt of entry.statements) {
      if (!/^\s*(CREATE|ALTER|DROP)\b/i.test(stmt)) continue;
      const probe = await probeEffectExists(sql, stmt);
      if (!probe.exists) {
        allPresent = false;
        break;
      }
    }
    if (allPresent) {
      outcome.trusted = entry.statements.length;
      return outcome;
    }
    // Fall through to the apply path below — an effect is genuinely missing.
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
