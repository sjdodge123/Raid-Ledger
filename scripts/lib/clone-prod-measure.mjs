#!/usr/bin/env node
/**
 * scripts/lib/clone-prod-measure.mjs — pure logic for
 * scripts/clone-prod-measure-migration.sh (ROK-2263, decision D12).
 *
 * The shell script owns Docker and psql; everything decidable without a
 * database lives here so node:test can pin it:
 *   parse-args <argv…>                    → config JSON (exit 2 on bad usage)
 *   scratch-url <database_url> [name]     → the scratch DB URL (never the main DB)
 *   plan <config> <migrations_dir> <applied.json>
 *                                         → plan JSON (exit 3 = refused)
 *   script <config> <migrations_dir>      → the BEGIN…ROLLBACK psql script
 *   report <config> <plan> <stdout> [<stderr>] [<exit_code>]
 *                                         → the D12 before/after JSON
 *
 * Drizzle facts this relies on (drizzle-orm pg migrator): a journal row's
 * `hash` is sha256 of the migration .sql text and `created_at` is the entry's
 * `when`; the migrator applies only entries whose `when` is newer than the
 * newest applied `created_at`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRATCH_DB = 'rl_clone_scratch';
const MARK = '__RL_MEASURE__';
const USAGE =
  'usage: clone-prod-measure-migration.sh --dump <file|latest> --migration <tag> ' +
  '--query <sql> [--query <sql> …] [--tree <path>]';

export class UsageError extends Error {}

const FLAG_KEYS = { '--dump': 'dump', '--migration': 'migration', '--tree': 'tree' };

/** Parses the script's argv into a config; throws UsageError on bad usage. */
export function parseMeasureArgs(argv) {
  const cfg = { dump: '', migration: '', tree: '', queries: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag !== '--query' && !(flag in FLAG_KEYS)) throw new UsageError(`unknown argument: ${flag}\n${USAGE}`);
    if (value === undefined || value === '') throw new UsageError(`${flag} needs a value\n${USAGE}`);
    if (flag === '--query') cfg.queries.push(stripTrailingSemicolons(value));
    else cfg[FLAG_KEYS[flag]] = value;
  }
  if (!cfg.dump) throw new UsageError(`--dump is required\n${USAGE}`);
  if (!cfg.migration) throw new UsageError(`--migration is required\n${USAGE}`);
  if (cfg.queries.length === 0) throw new UsageError(`at least one --query is required\n${USAGE}`);
  cfg.migration = cfg.migration.replace(/\.sql$/, '');
  if (!/^[0-9]{4}_[A-Za-z0-9_]+$/.test(cfg.migration)) {
    throw new UsageError(`--migration must be a journal tag like 0308_backup_export_tokens, got: ${cfg.migration}`);
  }
  if (cfg.queries.some((q) => q === '')) throw new UsageError('--query must not be empty');
  return cfg;
}

function stripTrailingSemicolons(sql) {
  return sql.trim().replace(/[;\s]+$/, '');
}

/** The scratch DB URL beside <databaseUrl>; refuses when it would be the main DB. */
export function scratchDatabaseUrl(databaseUrl, name = SCRATCH_DB) {
  const url = new URL(databaseUrl);
  const mainDb = url.pathname.replace(/^\//, '');
  if (!mainDb) throw new UsageError('DATABASE_URL has no database name');
  if (mainDb === name) throw new UsageError(`DATABASE_URL already points at the scratch DB ${name}; refusing`);
  url.pathname = `/${name}`;
  return url.toString();
}

/** sha256 of a migration's SQL text — drizzle's journal `hash`. */
export function migrationHash(sqlText) {
  return crypto.createHash('sha256').update(sqlText).digest('hex');
}

/** The tree's journal entries `{tag, when, hash}` in journal order. */
export function readTreeJournal(migrationsDir) {
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8'));
  return journal.entries.map(({ tag, when }) => ({
    tag,
    when: Number(when),
    hash: migrationHash(fs.readFileSync(path.join(migrationsDir, `${tag}.sql`), 'utf8')),
  }));
}

/** True when the SQL uses CONCURRENTLY, which cannot run inside BEGIN…ROLLBACK. */
export function usesConcurrently(sqlText) {
  const code = sqlText.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  return /\bCONCURRENTLY\b/i.test(code);
}

/**
 * Decides what to run. `applied` = the dump's journal rows `{hash, created_at}`.
 * Refuses a migration the dump already has (by hash or by `when`), one the
 * tree's journal lacks, and CONCURRENTLY. `pending` = earlier tree entries the
 * dump lacks (applied for real in the scratch DB first). `drizzleWouldSkip`
 * flags a migration older than prod's newest applied one.
 */
export function planMeasure({ entries, applied, migration, sqlText }) {
  const idx = entries.findIndex((e) => e.tag === migration);
  if (idx < 0) return refuse(`${migration} is not in the tree's meta/_journal.json`);
  const target = entries[idx];
  const hashes = new Set(applied.map((r) => r.hash));
  const times = applied.map((r) => Number(r.created_at)).filter(Number.isFinite);
  if (hashes.has(target.hash) || times.includes(target.when)) {
    return refuse(`${migration} is already in the dump's journal — it has run on prod; nothing to measure`);
  }
  if (usesConcurrently(sqlText)) {
    return refuse(`${migration} uses CONCURRENTLY, which cannot run inside a transaction — measure it by hand`);
  }
  const maxApplied = times.length ? Math.max(...times) : null;
  const pending = entries.slice(0, idx).filter((e) => !hashes.has(e.hash) && !times.includes(e.when));
  const drizzleWouldSkip = maxApplied !== null && target.when <= maxApplied;
  const warnings = drizzleWouldSkip
    ? [`${migration} has when=${target.when} <= prod's newest applied created_at=${maxApplied}: ` +
        "drizzle's migrator would SKIP it on prod — regenerate it with a newer timestamp"]
    : [];
  return { ok: true, migration, pending: pending.map((e) => e.tag), drizzleWouldSkip, maxApplied, warnings };
}

function refuse(error) {
  return { ok: false, error };
}

/** One query wrapped so psql prints exactly one JSON line after a marker. */
function measuredQuery(phase, i, sql) {
  return `\\echo ${MARK}${phase}:${i}\nSELECT coalesce(json_agg(q), '[]'::json) FROM (\n${sql}\n) q;\n`;
}

/** The single psql session: BEGIN; before; <migration>; after; ROLLBACK. */
export function buildMeasureScript(queries, migrationSql) {
  const before = queries.map((q, i) => measuredQuery('before', i, q)).join('');
  const after = queries.map((q, i) => measuredQuery('after', i, q)).join('');
  return [
    '\\set ON_ERROR_STOP on',
    'BEGIN;',
    before,
    `\\echo ${MARK}migration`,
    migrationSql,
    ';',
    after,
    'ROLLBACK;',
    '',
  ].join('\n');
}

/** Pulls the per-query JSON lines back out of psql's -tAqX stdout. */
export function parseMeasureOutput(stdout, queries) {
  const lines = stdout.split('\n');
  const out = { before: [], after: [] };
  lines.forEach((line, n) => {
    const m = line.match(new RegExp(`^${MARK}(before|after):(\\d+)$`));
    if (!m) return;
    const i = Number(m[2]);
    out[m[1]].push({ sql: queries[i], rows: JSON.parse(lines[n + 1] ?? '[]') });
  });
  return out;
}

/** The D12 report: `{migration, before, after, warnings, pending_applied, error?}`. */
export function buildReport({ config, plan, stdout, stderr = '', exitCode = 0 }) {
  const parsed = parseMeasureOutput(stdout, config.queries);
  const report = {
    migration: config.migration,
    before: parsed.before,
    after: parsed.after,
    pending_applied: plan.pending ?? [],
    warnings: plan.warnings ?? [],
  };
  if (exitCode !== 0) report.error = stderr.trim() || `psql exited ${exitCode}`;
  return report;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function migrationSqlOf(config, migrationsDir) {
  return fs.readFileSync(path.join(migrationsDir, `${config.migration}.sql`), 'utf8');
}

const COMMANDS = {
  'parse-args': (args) => JSON.stringify(parseMeasureArgs(args)),
  'scratch-url': ([url, name]) => scratchDatabaseUrl(url, name),
  plan: ([cfgFile, dir, appliedFile]) => {
    const config = readJson(cfgFile);
    const plan = planMeasure({
      entries: readTreeJournal(dir),
      applied: readJson(appliedFile),
      migration: config.migration,
      sqlText: migrationSqlOf(config, dir),
    });
    if (!plan.ok) process.exitCode = 3;
    return JSON.stringify(plan);
  },
  script: ([cfgFile, dir]) => {
    const config = readJson(cfgFile);
    return buildMeasureScript(config.queries, migrationSqlOf(config, dir));
  },
  report: ([cfgFile, planFile, stdoutFile, stderrFile, code]) => {
    const report = buildReport({
      config: readJson(cfgFile),
      plan: readJson(planFile),
      stdout: fs.readFileSync(stdoutFile, 'utf8'),
      stderr: stderrFile ? fs.readFileSync(stderrFile, 'utf8') : '',
      exitCode: Number(code ?? 0),
    });
    return JSON.stringify(report, null, 2);
  },
};

function main([cmd, ...args]) {
  const run = COMMANDS[cmd];
  if (!run) {
    process.stderr.write(`unknown command: ${cmd}\n`);
    return 2;
  }
  try {
    process.stdout.write(`${run(args)}\n`);
    return process.exitCode ?? 0;
  } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    return err instanceof UsageError ? 2 : 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
