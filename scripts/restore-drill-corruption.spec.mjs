/**
 * T-C2 — the restore drill's FAILURE path, end to end (ROK-1160, AC3).
 *
 * These cases shell out to the real `scripts/backup-restore-drill.sh`; they are
 * the lightest tier that can prove AC3 ("failure path verified via simulated
 * corruption"), because the behaviour under test lives in the shell script, not
 * in any importable module.
 *
 * The assertion that matters is the tier NAME. `reconcile-migrations.mjs`
 * cannot replay from zero hash rows today (slice A's D4 measurement, an open
 * operator ruling), so a drill against a *valid* dump also exits nonzero — an
 * "exits nonzero" assertion would pass for the wrong reason. Every case below
 * therefore asserts a finding with `tier === 'A1'` and `status === 'failed'`.
 *
 *   node --test scripts/restore-drill-corruption.spec.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { RestoreDrillReportSchema } from '../packages/contract/dist/index.js';
import { MIN_TOC_TABLE_ENTRIES } from './restore-drill.constants.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRILL = path.join(REPO_ROOT, 'scripts', 'backup-restore-drill.sh');

/**
 * A `pg_restore` stub placed first on PATH. It lets the A1 floor be exercised
 * with NO Postgres, NO docker and NO pg_restore on the machine: the real script
 * runs unmodified, only its `pg_restore --list` probe is answered by us. `n`
 * below the floor drives the TOC-shortfall branch.
 */
const stubPgRestore = (dir, tocEntries) => {
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, 'pg_restore');
  fs.writeFileSync(
    bin,
    `#!/bin/sh\n[ "$1" = "--list" ] || exit 0\ni=0\nwhile [ $i -lt ${tocEntries} ]; do\n  echo "$i; 0 0 TABLE DATA public t$i user"\n  i=$((i + 1))\ndone\n`,
  );
  fs.chmodSync(bin, 0o755);
  return dir;
};

/** Runs the drill against `dumpFile`, returning the exit code + report path. */
const runDrill = ({ dumpFile, pathPrefix }) => {
  const reportPath = path.join(path.dirname(dumpFile), 'restore-drill-report.json');
  const env = { ...process.env };
  if (pathPrefix) env.PATH = `${pathPrefix}:${env.PATH}`;
  const res = spawnSync('bash', [DRILL, '--dump-file', dumpFile, '--report', reportPath], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
  });
  return { ...res, reportPath };
};

const makeCorruptDump = (tmp, bytes) => {
  fs.mkdirSync(tmp, { recursive: true });
  const dump = path.join(tmp, 'corrupt_raid_ledger_2026-09-12.dump');
  fs.writeFileSync(dump, bytes);
  return dump;
};

const readReport = (reportPath) => {
  assert.ok(
    fs.existsSync(reportPath),
    `report file missing at ${reportPath} — the drill exited before emitting one`,
  );
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
};

const a1Finding = (report) => {
  const f = report.findings.filter((x) => x.tier === 'A1');
  assert.equal(f.length, 1, `expected exactly one A1 finding, got ${JSON.stringify(f)}`);
  return f[0];
};

test('T-C2 a corrupt dump fails the drill AT TIER A1 and still emits a failed report', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-drill-c2-'));
  const dump = makeCorruptDump(tmp, Buffer.from('not a postgres archive at all'));
  const short = Math.max(0, MIN_TOC_TABLE_ENTRIES - 17);

  const res = runDrill({ dumpFile: dump, pathPrefix: stubPgRestore(path.join(tmp, 'bin'), short) });

  assert.notEqual(res.status, 0, `drill should exit nonzero on a corrupt dump (stderr: ${res.stderr})`);
  const report = readReport(res.reportPath);
  assert.equal(report.status, 'failed', 'the report status must be failed');

  const a1 = a1Finding(report);
  assert.equal(a1.status, 'failed');
  assert.match(
    a1.detail,
    new RegExp(`${short} TABLE DATA entries.*>= ${MIN_TOC_TABLE_ENTRIES}`),
    `A1 detail must name the TOC-entry shortfall, got: ${a1.detail}`,
  );
  // No container was ever started: the failure path must be container-free.
  assert.equal(report.restoreDurationMs, 0);
});

test('T-C2 the emitted FAILURE report validates against RestoreDrillReportSchema', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-drill-c2-schema-'));
  const dump = makeCorruptDump(tmp, Buffer.from('garbage'));

  const res = runDrill({ dumpFile: dump, pathPrefix: stubPgRestore(path.join(tmp, 'bin'), 1) });
  assert.notEqual(res.status, 0);

  const parsed = RestoreDrillReportSchema.safeParse(readReport(res.reportPath));
  assert.ok(
    parsed.success,
    `failure report must satisfy the contract: ${JSON.stringify(parsed.error?.issues)}`,
  );
  assert.equal(parsed.data.status, 'failed');
});

/**
 * The same flow against a REAL `pg_restore` and genuinely corrupt bytes — this
 * is what `POST /admin/test/backup/simulate-corruption` (mode `garbage`) writes.
 * Skipped loudly, never failed, when the client binary is absent — mirroring
 * `api/src/backup/backup.integration.spec.ts`'s SKIP_BACKUP_INTEGRATION gate.
 */
const hasPgRestore =
  !process.env.SKIP_BACKUP_INTEGRATION &&
  spawnSync('pg_restore', ['--version'], { encoding: 'utf8' }).status === 0;

test('T-C2 real pg_restore rejects the `garbage` fixture at tier A1', { skip: hasPgRestore ? false : 'pg_restore unavailable or SKIP_BACKUP_INTEGRATION set' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-drill-c2-real-'));
  const dump = makeCorruptDump(tmp, Buffer.alloc(4096, 0x41));

  const res = runDrill({ dumpFile: dump });

  assert.notEqual(res.status, 0);
  const a1 = a1Finding(readReport(res.reportPath));
  assert.equal(a1.status, 'failed');
  assert.match(a1.detail, /pg_restore --list failed/, `got: ${a1.detail}`);
});

/**
 * T-I4 — the D5 branch. A dump whose TOC reads fine (A1 passes) but whose
 * `pg_restore` emits a fatal error line must STILL leave a report behind:
 * slice B wired `emit_failure_report` into the A1 branch only, so this exit
 * path produced a log line and nothing else — a DR drill that fails silently.
 *
 * Hermetic: `pg_restore` AND `docker` are both stubbed on PATH, so the whole
 * restore branch runs with no daemon, no container and no Postgres.
 */
const stubDocker = (dir, restoreError) => {
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, 'docker');
  fs.writeFileSync(
    bin,
    [
      '#!/bin/sh',
      'case "$1" in',
      '  run) echo drill-stub-container ;;',
      '  port) echo "0.0.0.0:55432" ;;',
      '  exec)',
      '    for a in "$@"; do',
      '      if [ "$a" = "pg_restore" ]; then',
      `        echo "${restoreError}" >&2`,
      '        exit 1',
      '      fi',
      '    done',
      '    exit 0 ;;',
      '  *) exit 0 ;;',
      'esac',
      '',
    ].join('\n'),
  );
  fs.chmodSync(bin, 0o755);
  return dir;
};

const RESTORE_ERROR =
  'pg_restore: error: could not execute query: ERROR: permission denied for schema public';

test('T-I4 a dump that reads but fails to restore still emits a failed report', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-drill-i4-'));
  const dump = makeCorruptDump(tmp, Buffer.from('a readable TOC, an unrestorable body'));
  const bin = path.join(tmp, 'bin');
  stubPgRestore(bin, MIN_TOC_TABLE_ENTRIES + 5);
  stubDocker(bin, RESTORE_ERROR);

  const res = runDrill({ dumpFile: dump, pathPrefix: bin });

  assert.notEqual(res.status, 0, `drill should exit nonzero (stderr: ${res.stderr})`);
  const report = readReport(res.reportPath);
  assert.equal(report.status, 'failed', 'the report status must be failed');

  // A1 genuinely passed — the drill must not relabel the tier that failed.
  assert.equal(a1Finding(report).status, 'passed');
  const restore = report.findings.find((f) => f.tier === 'restore');
  assert.ok(restore, `expected a restore-tier finding, got ${JSON.stringify(report.findings)}`);
  assert.equal(restore.status, 'failed');
  assert.match(restore.detail, /permission denied for schema public/);

  const parsed = RestoreDrillReportSchema.safeParse(report);
  assert.ok(parsed.success, `report must satisfy the contract: ${JSON.stringify(parsed.error?.issues)}`);
});

/** The drill is shell, so its syntax + lint gate is a test like any other. */
test('the drill script parses under bash -n', () => {
  const res = spawnSync('bash', ['-n', DRILL], { encoding: 'utf8' });
  assert.equal(res.status, 0, `bash -n failed: ${res.stderr}`);
});

const hasShellcheck = spawnSync('shellcheck', ['--version'], { encoding: 'utf8' }).status === 0;

test('the drill script is shellcheck-clean', { skip: hasShellcheck ? false : 'shellcheck unavailable' }, () => {
  const res = spawnSync('shellcheck', ['-S', 'warning', DRILL], { encoding: 'utf8' });
  assert.equal(res.status, 0, `shellcheck findings:\n${res.stdout}`);
});

/**
 * Source guard for the D7 fix. Comments are stripped first: the header
 * documents the OLD `/api/health` URL on purpose, and a naive grep would trip
 * on its own explanation.
 */
test('the boot check polls no hardcoded port and no /api/health', () => {
  const code = fs
    .readFileSync(DRILL, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  assert.doesNotMatch(code, /127\.0\.0\.1:3000/, 'the drill must not hardcode :3000');
  assert.doesNotMatch(code, /\/api\/health/, 'the API serves /health at the root');
});
