// node:test spec for scripts/pr-watch.sh (ROK-2309).
//
// Drives the REAL script against a FAKE `gh` (GH_BIN): a tiny shell script
// that answers `gh pr view <n> ...` with canned JSON from a temp dir. Per PR,
// call k reads `<n>.<k>.json` when it exists, else `<n>.json`, so a case can
// change the answer over time (BEHIND then MERGED). A file containing only
// `ERR` makes the fake exit 1, like a network blip. Interval is 0, so no case
// sleeps; nothing here talks to GitHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'pr-watch.sh');
// PR_WATCH_SPEC_BASH=/bin/bash pins macOS bash 3.2 when running locally.
const BASH = process.env.PR_WATCH_SPEC_BASH ?? 'bash';

const FAKE_GH = `#!/bin/sh
n=$3
c=$(cat "$FAKE_DIR/$n.count" 2>/dev/null || echo 0)
c=$((c + 1))
echo "$c" > "$FAKE_DIR/$n.count"
f="$FAKE_DIR/$n.$c.json"
[ -f "$f" ] || f="$FAKE_DIR/$n.json"
if [ "$(cat "$f")" = ERR ]; then echo "HTTP 502: bad gateway" >&2; exit 1; fi
cat "$f"
`;

const run = (n, k) => ({ __typename: 'CheckRun', name: n, status: 'COMPLETED', conclusion: k });
const pr = (number, state, mergeStateStatus, checks = [], auto = true) =>
  JSON.stringify({
    number,
    state,
    mergeStateStatus,
    autoMergeRequest: auto ? { mergeMethod: 'SQUASH' } : null,
    statusCheckRollup: checks,
  });

/** Runs pr-watch.sh with `files` ({ 'n.json' | 'n.k.json': body }) behind the fake gh. */
function watch(files, args, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pr-watch-'));
  try {
    const gh = join(dir, 'gh');
    writeFileSync(gh, FAKE_GH);
    chmodSync(gh, 0o755);
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    const r = spawnSync(BASH, [SCRIPT, '--interval', '0', ...args], {
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, GH_BIN: gh, FAKE_DIR: dir, ...env },
    });
    return { code: r.status, lines: r.stdout.trim().split('\n'), stderr: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('all merged exits 0 with one status line per PR and a timestamp', () => {
  const r = watch(
    { '1.json': pr(1, 'MERGED', 'UNKNOWN', [run('lint', 'SUCCESS')]), '2.json': pr(2, 'MERGED', 'UNKNOWN') },
    ['1', '2'],
  );
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.lines[0], 'ALL MERGED');
  assert.equal(r.lines[1], '#1 MERGED UNKNOWN auto=true failing=-');
  assert.equal(r.lines[2], '#2 MERGED UNKNOWN auto=true failing=-');
  assert.match(r.lines[3] ?? '', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
});

test('a failed check exits 1 and names every failing check', () => {
  const checks = [run('lint', 'SUCCESS'), run('api-unit', 'FAILURE'), run('e2e', 'TIMED_OUT')];
  const r = watch({ '1.json': pr(1, 'MERGED', 'UNKNOWN'), '2.json': pr(2, 'OPEN', 'BLOCKED', checks) }, ['1', '2']);
  assert.equal(r.code, 1, r.stderr);
  assert.equal(r.lines[0], 'FAILED #2: api-unit, e2e');
  assert.equal(r.lines[2], '#2 OPEN BLOCKED auto=true failing=api-unit, e2e');
});

test('a PR closed without merging exits 1 with CLOSED', () => {
  const r = watch({ '7.json': pr(7, 'CLOSED', 'UNKNOWN', [], false) }, ['7']);
  assert.equal(r.code, 1, r.stderr);
  assert.equal(r.lines[0], 'CLOSED #7');
  assert.equal(r.lines[1], '#7 CLOSED UNKNOWN auto=false failing=-');
});

test('BEHIND with nothing running past the threshold exits STUCK', () => {
  const r = watch({ '3.json': pr(3, 'OPEN', 'BEHIND', [run('lint', 'SUCCESS')]) }, ['3', '--stuck-minutes', '0']);
  assert.equal(r.code, 1, r.stderr);
  assert.equal(r.lines[0], 'STUCK #3: BEHIND for >0 min');
});

test('BEHIND that merges before the threshold is not reported stuck', () => {
  const files = { '3.1.json': pr(3, 'OPEN', 'BEHIND'), '3.2.json': pr(3, 'OPEN', 'BEHIND'), '3.json': pr(3, 'MERGED', 'UNKNOWN') };
  const r = watch(files, ['3', '--stuck-minutes', '20']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.lines[0], 'ALL MERGED');
});

test('BEHIND while checks are still running is not stuck', () => {
  const running = [{ __typename: 'CheckRun', name: 'api-unit', status: 'IN_PROGRESS', conclusion: null }];
  const r = watch({ '3.json': pr(3, 'OPEN', 'BEHIND', running) }, ['3', '--stuck-minutes', '0', '--minutes', '0']);
  assert.equal(r.code, 2, r.stderr);
  assert.equal(r.lines[0], 'TIMEOUT');
});

test('DIRTY past the threshold exits STUCK', () => {
  const r = watch({ '4.json': pr(4, 'OPEN', 'DIRTY') }, ['4'], { PR_WATCH_STUCK_SECONDS: '0' });
  assert.equal(r.code, 1, r.stderr);
  assert.equal(r.lines[0], 'STUCK #4: DIRTY for >20 min');
});

test('an open PR past --minutes exits 2 with TIMEOUT and all status lines', () => {
  const r = watch({ '5.json': pr(5, 'OPEN', 'BLOCKED'), '6.json': pr(6, 'MERGED', 'UNKNOWN') }, ['--minutes', '0', '5', '6']);
  assert.equal(r.code, 2, r.stderr);
  assert.deepEqual(r.lines.slice(0, 3), ['TIMEOUT', '#5 OPEN BLOCKED auto=true failing=-', '#6 MERGED UNKNOWN auto=true failing=-']);
});

test('a CANCELLED check (superseded run) is not treated as a failure', () => {
  const files = {
    '8.1.json': pr(8, 'OPEN', 'BLOCKED', [run('api-unit', 'CANCELLED')]),
    '8.json': pr(8, 'MERGED', 'UNKNOWN', [run('api-unit', 'SUCCESS')]),
  };
  const r = watch(files, ['8']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.lines[0], 'ALL MERGED');
});

test('a transient gh error is retried; three in a row exits ERROR', () => {
  const blip = watch({ '9.1.json': 'ERR', '9.2.json': 'ERR', '9.json': pr(9, 'MERGED', 'UNKNOWN') }, ['9']);
  assert.equal(blip.code, 0, blip.stderr);
  assert.equal(blip.lines[0], 'ALL MERGED');

  const dead = watch({ '9.json': 'ERR' }, ['9']);
  assert.equal(dead.code, 1, dead.stderr);
  assert.equal(dead.lines[0], 'ERROR #9: HTTP 502: bad gateway');
});

test('usage errors exit 64', () => {
  for (const args of [[], ['--minutes'], ['--minutes', 'x', '1'], ['abc'], ['--bogus', '1']]) {
    const r = watch({}, args);
    assert.equal(r.code, 64, `args ${JSON.stringify(args)}: ${r.stderr}`);
    assert.match(r.stderr, /^usage:/);
  }
});

test('a STARTUP_FAILURE check is a failure and exits 1 at once', () => {
  const r = watch({ '3.json': pr(3, 'OPEN', 'BLOCKED', [run('build', 'STARTUP_FAILURE')]) }, ['3', '--minutes', '1']);
  assert.equal(r.code, 1, r.stderr);
  assert.equal(r.lines[0], 'FAILED #3: build');
});

test('an unknown conclusion counts as failed and is named with its conclusion', () => {
  const r = watch({ '4.json': pr(4, 'OPEN', 'BLOCKED', [run('odd', 'WEIRD')]) }, ['4', '--minutes', '1']);
  assert.equal(r.code, 1, r.stderr);
  assert.equal(r.lines[0], 'FAILED #4: odd (WEIRD)');
});

test('SKIPPED and NEUTRAL checks are not failures', () => {
  const files = {
    '5.1.json': pr(5, 'OPEN', 'BLOCKED', [run('a', 'SKIPPED'), run('b', 'NEUTRAL')]),
    '5.json': pr(5, 'MERGED', 'UNKNOWN', [run('a', 'SKIPPED'), run('b', 'NEUTRAL')]),
  };
  const r = watch(files, ['5']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.lines[0], 'ALL MERGED');
});
