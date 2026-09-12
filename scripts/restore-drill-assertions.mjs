#!/usr/bin/env node
/**
 * restore-drill-assertions.mjs — the five assertion tiers (A1–A5), the
 * pg_restore stderr classifier (D5) and the D11 safety rails for ROK-1160.
 *
 * Every check takes its I/O as an injected dependency so the unit spec needs
 * no database and no binaries:
 *   - `sql(text) => Promise<rows[]>`  (the CLI wraps postgres.js `unsafe`)
 *   - `execFile(cmd, args) => Promise<{stdout,stderr}>`, rejecting on nonzero.
 *
 * Every check returns `DrillFinding[]`:
 *   { id, tier: 'A1'|'A2'|'A3'|'A4'|'A5'|'reconcile'|'boot',
 *     status: 'passed'|'failed'|'informational', detail: string }
 * The caller reports EVERY failing finding, never just the first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BENIGN_RESTORE_ERRORS,
  CORE_COUNT_TABLES,
  CRITICAL_INDEXES,
  CRITICAL_TABLES,
  MIN_TOC_TABLE_ENTRIES,
  SANITIZED_EXCLUDED_TABLES,
} from './restore-drill.constants.mjs';

const finding = (id, tier, status, detail) => ({ id, tier, status, detail });
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * D11 rail check — runs BEFORE any DDL and THROWS (never warns). The drill's
 * only legal write target is the container it just started and will
 * `docker rm -f`. Modelled on clone-prod-to-local.sh:99-100.
 */
export function assertRails({ databaseUrl, dbName, forbiddenHosts = [] }) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('rail-1: drill DATABASE_URL is not a parsable URL');
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `rail-1: drill DATABASE_URL host must be localhost, got "${url.hostname}"`,
    );
  }
  const target = url.pathname.replace(/^\//, '');
  if (target !== dbName) {
    throw new Error(
      `rail-2: drill database must be "${dbName}", got "${target}"`,
    );
  }
  const clash = forbiddenHosts.filter(Boolean).find((h) => {
    try {
      return new URL(h).hostname === url.hostname;
    } catch {
      return h === url.hostname;
    }
  });
  if (clash) {
    throw new Error(`rail-2: drill host collides with fetch host "${clash}"`);
  }
}

/**
 * D5 classifier. The pass criterion is stderr, NOT pg_restore's exit status:
 * `isRestoreFatal` (backup.helpers.ts:145-152) treats "errors ignored on
 * restore" as success, and a drill that inherits that tolerance passes without
 * really restoring — the exact failure mode this story exists to eliminate.
 */
export function classifyRestoreStderr(stderr) {
  const errorLines = String(stderr || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('pg_restore: error:'));
  const fatalLines = errorLines.filter(
    (l) => !BENIGN_RESTORE_ERRORS.some((b) => l.includes(b)),
  );
  return { fatal: fatalLines.length > 0, fatalLines, errorLines };
}

/** A1 — archive integrity. Runs before the container starts. */
export async function runArchiveCheck({ execFile, dumpFile }) {
  let stdout;
  try {
    ({ stdout } = await execFile('pg_restore', ['--list', dumpFile]));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return [
      finding('a1-toc-readable', 'A1', 'failed', `pg_restore --list failed: ${detail}`),
    ];
  }
  const entries = String(stdout)
    .split('\n')
    .filter((l) => l.includes('TABLE DATA')).length;
  if (entries < MIN_TOC_TABLE_ENTRIES) {
    return [
      finding(
        'a1-toc-entries',
        'A1',
        'failed',
        `archive TOC lists ${entries} TABLE DATA entries, expected >= ${MIN_TOC_TABLE_ENTRIES}`,
      ),
    ];
  }
  return [
    finding('a1-toc-entries', 'A1', 'passed', `${entries} TABLE DATA entries`),
  ];
}

/**
 * A2 — schema shape. Runs AFTER reconcile, so a table the backup predates but
 * the journal creates is genuinely expected to exist. Tables present in code
 * but absent from the restore are INFORMATIONAL (a backup is always >= 1 day
 * old), while the critical subset FAILS.
 */
export async function runSchemaShapeCheck({ sql, codeTables = [] }) {
  const tableRows = await sql(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const present = new Set(tableRows.map((r) => r.table_name));
  const indexRows = await sql(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
  );
  const indexes = new Set(indexRows.map((r) => r.indexname));
  const findings = [];
  for (const t of CRITICAL_TABLES) {
    findings.push(
      present.has(t)
        ? finding(`a2-table-${t}`, 'A2', 'passed', `critical table ${t} present`)
        : finding(`a2-table-${t}`, 'A2', 'failed', `critical table ${t} MISSING`),
    );
  }
  for (const i of CRITICAL_INDEXES) {
    findings.push(
      indexes.has(i)
        ? finding(`a2-index-${i}`, 'A2', 'passed', `critical index ${i} present`)
        : finding(`a2-index-${i}`, 'A2', 'failed', `critical index ${i} MISSING`),
    );
  }
  const drift = codeTables.filter((t) => !present.has(t));
  if (drift.length > 0) {
    findings.push(
      finding(
        'a2-schema-drift',
        'A2',
        'informational',
        `in code but not in the restore (expected after a post-dump migration): ${drift.join(', ')}`,
      ),
    );
  }
  return findings;
}

const countOf = async (sql, table) => {
  const rows = await sql(`SELECT count(*)::int AS n FROM "${table}"`);
  return Number(rows[0]?.n ?? 0);
};

/** A3 — row-count floor. An empty `users` is never a successful restore. */
export async function runRowCountCheck({ sql }) {
  const findings = [];
  for (const { table, ts } of CORE_COUNT_TABLES) {
    const n = await countOf(sql, table);
    findings.push(
      n > 0
        ? finding(`a3-count-${table}`, 'A3', 'passed', `${table}: ${n} rows (ts ${ts})`)
        : finding(`a3-count-${table}`, 'A3', 'failed', `${table} has 0 rows`),
    );
  }
  return findings;
}

/**
 * A4 — referential integrity. BOTH halves are required: the orphan probe alone
 * passes vacuously when the constraint was never re-added and no orphans
 * happen to exist, which is exactly what `isRestoreFatal`'s tolerance waves
 * through.
 */
export async function runReferentialCheck({ sql }) {
  const findings = [];
  const fk = await sql(
    `SELECT conname FROM pg_constraint
      WHERE contype = 'f' AND conrelid = 'public.event_signups'::regclass
        AND confrelid = 'public.events'::regclass`,
  );
  findings.push(
    fk.length > 0
      ? finding('a4-fk-present', 'A4', 'passed', `event_signups FK present (${fk[0].conname})`)
      : finding('a4-fk-present', 'A4', 'failed', 'event_signups.event_id -> events.id FK is MISSING'),
  );
  const orphans = await sql(
    `SELECT count(*)::int AS n FROM event_signups s
       LEFT JOIN events e ON e.id = s.event_id WHERE e.id IS NULL`,
  );
  const n = Number(orphans[0]?.n ?? 0);
  findings.push(
    n === 0
      ? finding('a4-orphans', 'A4', 'passed', 'no orphaned event_signups rows')
      : finding('a4-orphans', 'A4', 'failed', `${n} orphaned event_signups rows`),
  );
  return findings;
}

/** A5 — sanitization invariant (ROK-1279): those tables must be empty. */
export async function runSanitizationCheck({
  sql,
  excludedTables = SANITIZED_EXCLUDED_TABLES,
}) {
  const findings = [];
  for (const table of excludedTables) {
    const n = await countOf(sql, table);
    findings.push(
      n === 0
        ? finding(`a5-empty-${table}`, 'A5', 'passed', `${table} is empty`)
        : finding(`a5-empty-${table}`, 'A5', 'failed', `${table} carries ${n} row(s) — sanitization broke`),
    );
  }
  return findings;
}

/** Aggregate: `passed` only when no finding is `failed`. */
export function summarize(findings) {
  const failed = findings.filter((f) => f.status === 'failed');
  return { status: failed.length === 0 ? 'passed' : 'failed', failed };
}

/** The four database-backed tiers, in drill-sequence order (steps 10-13). */
export async function runDatabaseTiers({ sql, codeTables = [] }) {
  return [
    ...(await runSchemaShapeCheck({ sql, codeTables })),
    ...(await runRowCountCheck({ sql })),
    ...(await runReferentialCheck({ sql })),
    ...(await runSanitizationCheck({ sql })),
  ];
}

/** Table names declared in `api/src/drizzle/schema` — A2's informational half. */
export function readCodeTables(schemaDir) {
  const out = new Set();
  for (const f of fs.readdirSync(schemaDir).filter((n) => n.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(schemaDir, f), 'utf8');
    for (const m of src.matchAll(/pgTable\(\s*['"]([a-z0-9_]+)['"]/g)) {
      out.add(m[1]);
    }
  }
  return [...out];
}

/**
 * CLI entry (drill-sequence step 15): `--meta <file>` carries the partial
 * report the shell harness built (timings, dump info, and the findings from
 * A1 / restore / reconcile). This runs the database tiers, merges, and writes
 * `--out`. Exit 0 = passed, 1 = a failing finding, 2 = harness error.
 */
async function main(argv) {
  const arg = (n) => {
    const i = argv.indexOf(n);
    return i === -1 ? undefined : argv[i + 1];
  };
  const meta = JSON.parse(fs.readFileSync(arg('--meta'), 'utf8'));
  const { default: postgres } = await import('postgres');
  const client = postgres(arg('--database-url'), { max: 1, onnotice: () => {} });
  let findings = meta.findings ?? [];
  try {
    const tiers = await runDatabaseTiers({
      sql: (text) => client.unsafe(text),
      codeTables: readCodeTables(arg('--schema-dir')),
    });
    findings = [...findings, ...tiers];
  } finally {
    await client.end({ timeout: 5 });
  }
  const report = {
    ...meta,
    findings,
    finishedAt: new Date().toISOString(),
    status: summarize(findings).status,
  };
  fs.writeFileSync(arg('--out'), `${JSON.stringify(report, null, 2)}\n`);
  for (const f of findings.filter((x) => x.status !== 'passed')) {
    console.error(`[${f.status}] ${f.tier} ${f.id}: ${f.detail}`);
  }
  process.exit(report.status === 'passed' ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`ERROR: ${err?.message ?? err}`);
    process.exit(2);
  });
}
