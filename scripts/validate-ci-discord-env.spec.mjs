// node:test spec for validate-ci.sh's `check_test_bot_env` gate.
//
// Why this exists: validate-ci.sh stops at the FIRST failing step, so the
// Discord smoke tier failing for a reason that has nothing to do with the diff
// — a checkout with no companion-bot credentials — marks the whole run failed
// and hides a Playwright tier that already passed. That is what kept the
// pre-push sentinel shut through four consecutive ROK-1533 `--only-e2e` tiers.
//
// The contract pinned here mirrors the pg_dump / SKIP_BACKUP_INTEGRATION
// precedent already in the file:
//   * credentials present  -> run (no skip flag),
//   * absent, local run    -> exit 0, SKIP_DISCORD_SMOKE_NO_BOT_ENV=1,
//   * absent, --ci         -> exit 1 (CI always provisions them, so a silent
//                             skip there would be lost coverage).
//
// The function is extracted from the script rather than sourced: validate-ci.sh
// executes its main flow on source, so it cannot be pulled into a test shell
// whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'validate-ci.sh');

/** The `check_test_bot_env` body, lifted out of validate-ci.sh verbatim. */
function extractFunction(name) {
  const src = readFileSync(SCRIPT, 'utf8');
  const start = src.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `${name} not found in validate-ci.sh`);
  const end = src.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `unterminated ${name} in validate-ci.sh`);
  return src.slice(start, end + 3);
}

/**
 * Run the extracted gate in a throwaway shell.
 * Returns { code, skipped, stdout } — `skipped` reflects the exported
 * SKIP_DISCORD_SMOKE_NO_BOT_ENV the real step branches on.
 */
function runGate({ hasEnvFile, token, ciMode }) {
  const root = mkdtempSync(join(tmpdir(), 'validate-ci-botenv-'));
  try {
    mkdirSync(join(root, 'tools', 'test-bot'), { recursive: true });
    if (hasEnvFile) writeFileSync(join(root, 'tools', 'test-bot', '.env'), 'TEST_BOT_TOKEN=x\n');

    const script = [
      'set -uo pipefail',
      `REPO_ROOT=${JSON.stringify(root)}`,
      'RED=""; YELLOW=""; NC=""',
      `ci_mode=${ciMode ? 'true' : 'false'}`,
      token === undefined ? 'unset TEST_BOT_TOKEN || true' : `export TEST_BOT_TOKEN=${JSON.stringify(token)}`,
      extractFunction('check_test_bot_env'),
      'check_test_bot_env; rc=$?',
      'echo "SKIPFLAG=${SKIP_DISCORD_SMOKE_NO_BOT_ENV:-}"',
      'exit $rc',
    ].join('\n');

    let stdout = '';
    let code = 0;
    try {
      stdout = execFileSync('bash', ['-c', script], { encoding: 'utf8' });
    } catch (err) {
      code = err.status ?? 1;
      stdout = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    return { code, stdout, skipped: /SKIPFLAG=1/.test(stdout) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('runs the tier when tools/test-bot/.env is present', () => {
  const r = runGate({ hasEnvFile: true, token: undefined, ciMode: false });
  assert.equal(r.code, 0);
  assert.equal(r.skipped, false);
});

test('runs the tier when TEST_BOT_TOKEN is exported without a .env file', () => {
  const r = runGate({ hasEnvFile: false, token: 'a-token', ciMode: false });
  assert.equal(r.code, 0);
  assert.equal(r.skipped, false);
});

test('SKIPS (not fails) locally when the checkout has no bot credentials', () => {
  const r = runGate({ hasEnvFile: false, token: undefined, ciMode: false });
  assert.equal(r.code, 0, 'a missing local credential must not fail the gate');
  assert.equal(r.skipped, true);
  assert.match(r.stdout, /No tools\/test-bot\/\.env on this checkout/);
});

test('hard-fails under --ci when the checkout has no bot credentials', () => {
  const r = runGate({ hasEnvFile: false, token: undefined, ciMode: true });
  assert.equal(r.code, 1, 'CI provisions the credential; skipping there loses coverage');
  assert.equal(r.skipped, false);
  assert.match(r.stdout, /CI mode requires companion-bot credentials/);
});

test('an empty TEST_BOT_TOKEN counts as absent', () => {
  const r = runGate({ hasEnvFile: false, token: '', ciMode: false });
  assert.equal(r.code, 0);
  assert.equal(r.skipped, true);
});
