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
function runGate({ hasEnvFile, token, guildId, ciMode, rlTarget, marker }) {
  const root = mkdtempSync(join(tmpdir(), 'validate-ci-botenv-'));
  try {
    mkdirSync(join(root, 'tools', 'test-bot'), { recursive: true });
    if (hasEnvFile) writeFileSync(join(root, 'tools', 'test-bot', '.env'), 'TEST_BOT_TOKEN=x\n');

    const script = [
      'set -uo pipefail',
      `REPO_ROOT=${JSON.stringify(root)}`,
      'RED=""; YELLOW=""; NC=""',
      `ci_mode=${ciMode ? 'true' : 'false'}`,
      rlTarget === undefined
        ? 'unset RL_TARGET || true'
        : `export RL_TARGET=${JSON.stringify(rlTarget)}`,
      marker === undefined
        ? 'unset RL_DISCORD_CREDS_MISSING || true'
        : `export RL_DISCORD_CREDS_MISSING=${JSON.stringify(marker)}`,
      token === undefined
        ? 'unset TEST_BOT_TOKEN || true'
        : `export TEST_BOT_TOKEN=${JSON.stringify(token)}`,
      guildId === undefined
        ? 'unset TEST_GUILD_ID || true'
        : `export TEST_GUILD_ID=${JSON.stringify(guildId)}`,
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
  const r = runGate({ hasEnvFile: true, ciMode: false });
  assert.equal(r.code, 0);
  assert.equal(r.skipped, false);
});

test('runs the tier when the full env-var set is exported without a .env file', () => {
  const r = runGate({ hasEnvFile: false, token: 'a-token', guildId: '42', ciMode: false });
  assert.equal(r.code, 0);
  assert.equal(r.skipped, false);
});

test('SKIPS (not fails) locally when the checkout has no bot credentials', () => {
  const r = runGate({ hasEnvFile: false, ciMode: false });
  assert.equal(r.code, 0, 'a missing local credential must not fail the gate');
  assert.equal(r.skipped, true);
  assert.match(r.stdout, /No tools\/test-bot\/\.env on this checkout/);
});

test('hard-fails under --ci when the checkout has no bot credentials', () => {
  const r = runGate({ hasEnvFile: false, ciMode: true });
  assert.equal(r.code, 1, 'CI provisions the credential; skipping there loses coverage');
  assert.equal(r.skipped, false);
  assert.match(r.stdout, /CI mode requires companion-bot credentials/);
});

test('an empty TEST_BOT_TOKEN counts as absent', () => {
  const r = runGate({ hasEnvFile: false, token: '', guildId: '42', ciMode: false });
  assert.equal(r.code, 0);
  assert.equal(r.skipped, true);
});

// Codex P2: the bot needs TEST_BOT_TOKEN *and* TEST_GUILD_ID
// (tools/test-bot/src/config.ts). A partial env must not pass the preflight and
// then die in config load — that is the failure this gate exists to prevent.
test('a token without TEST_GUILD_ID is an incomplete env, not a pass', () => {
  const r = runGate({ hasEnvFile: false, token: 'a-token', ciMode: false });
  assert.equal(r.code, 0);
  assert.equal(r.skipped, true, 'incomplete env must SKIP, not run');
  assert.match(r.stdout, /TEST_GUILD_ID/);
});

test('an incomplete env hard-fails under --ci and names what is missing', () => {
  const r = runGate({ hasEnvFile: false, token: 'a-token', ciMode: true });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /TEST_GUILD_ID/);
});

// ROK-2280: on a fleet runner the credentials come from the VM's
// /srv/rl-infra/.env (RL_TEST_BOT_TOKEN / RL_DISCORD_TEST_GUILD_ID), forwarded
// by run-on-runner-with-heartbeat (which also exports RL_TARGET=runner) ONLY
// into an rl_validate_ci task that includes the Discord tier. When such a task
// lacks a VM key, the wrapper forwards RL_DISCORD_CREDS_MISSING (key NAMES) and
// the SKIP names exactly those keys. With no marker the creds were withheld on
// purpose (rl validate-ci, /push self-dispatch, rl_run_on_runner), so the SKIP
// must NOT tell the reader to set a VM key.
const FLEET_SETUP_LINE = /rl-infra\/SETUP\.md §3\.2; takes effect on the next gate, no restart/;

test('fleet runner with a marker naming both keys names both and the setup pointer', () => {
  const r = runGate({
    hasEnvFile: false, ciMode: false, rlTarget: 'runner',
    marker: 'RL_TEST_BOT_TOKEN, RL_DISCORD_TEST_GUILD_ID',
  });
  assert.equal(r.code, 0);
  assert.equal(r.skipped, true);
  assert.match(r.stdout, /Fleet runner: companion-bot credentials come from the VM — set RL_TEST_BOT_TOKEN, RL_DISCORD_TEST_GUILD_ID in \/srv\/rl-infra\/\.env/);
  assert.match(r.stdout, FLEET_SETUP_LINE);
  assert.doesNotMatch(r.stdout, /Copy it from the main repo/);
});

test('fleet runner with a marker naming only the token names only RL_TEST_BOT_TOKEN', () => {
  const r = runGate({ hasEnvFile: false, ciMode: false, rlTarget: 'runner', marker: 'RL_TEST_BOT_TOKEN' });
  assert.equal(r.skipped, true);
  assert.match(r.stdout, /set RL_TEST_BOT_TOKEN in \/srv\/rl-infra\/\.env/);
  assert.doesNotMatch(r.stdout, /RL_DISCORD_TEST_GUILD_ID/);
});

test('fleet runner with a marker naming only the guild names only RL_DISCORD_TEST_GUILD_ID', () => {
  const r = runGate({ hasEnvFile: false, ciMode: false, rlTarget: 'runner', marker: 'RL_DISCORD_TEST_GUILD_ID' });
  assert.equal(r.skipped, true);
  assert.match(r.stdout, /set RL_DISCORD_TEST_GUILD_ID in \/srv\/rl-infra\/\.env/);
  assert.doesNotMatch(r.stdout, /RL_TEST_BOT_TOKEN/);
});

test('fleet runner with no marker says creds go only to a Discord-tier rl_validate_ci task', () => {
  const r = runGate({ hasEnvFile: false, ciMode: false, rlTarget: 'runner' });
  assert.equal(r.code, 0);
  assert.equal(r.skipped, true);
  assert.match(r.stdout, /Fleet runner: companion-bot credentials are forwarded only into an rl_validate_ci task that includes the Discord tier \(--only-e2e \/ --with-e2e \/ --fleet \/ a full run\), not into rl validate-ci, \/push self-dispatch or rl_run_on_runner\./);
  assert.match(r.stdout, /Run the tier with rl_validate_ci to cover the changed bot\/notification flows\./);
  assert.doesNotMatch(r.stdout, /\/srv\/rl-infra\/\.env/, 'the key may be set; do not send the reader to the VM');
  assert.doesNotMatch(r.stdout, /Copy it from the main repo/);
});

test('fleet runner with a junk marker falls back to naming both keys and never echoes it', () => {
  const r = runGate({
    hasEnvFile: false, ciMode: false, rlTarget: 'runner',
    marker: 'RL_TEST_BOT_TOKEN; rm -rf $(sentinel-tok-XYZ)',
  });
  assert.equal(r.skipped, true);
  assert.match(r.stdout, /set RL_TEST_BOT_TOKEN, RL_DISCORD_TEST_GUILD_ID in \/srv\/rl-infra\/\.env/);
  assert.doesNotMatch(r.stdout, /sentinel-tok-XYZ|rm -rf/);
});

test('a runner token value is never echoed', () => {
  const r = runGate({ hasEnvFile: false, token: 'sentinel-tok-XYZ', ciMode: false, rlTarget: 'runner', marker: 'RL_DISCORD_TEST_GUILD_ID' });
  assert.equal(r.skipped, true);
  assert.doesNotMatch(r.stdout, /sentinel-tok-XYZ/, 'a credential value is never echoed');
});

test('laptop wording is unchanged and never mentions the VM keys', () => {
  const r = runGate({ hasEnvFile: false, ciMode: false, marker: 'RL_TEST_BOT_TOKEN' });
  assert.equal(r.skipped, true);
  assert.match(r.stdout, /No tools\/test-bot\/\.env on this checkout \(missing: TEST_BOT_TOKEN, TEST_GUILD_ID\) — skipping Discord smoke\./);
  assert.match(r.stdout, /Copy it from the main repo \(or export TEST_BOT_TOKEN \+ TEST_GUILD_ID\)/);
  assert.doesNotMatch(r.stdout, /RL_TEST_BOT_TOKEN|RL_DISCORD_TEST_GUILD_ID|Fleet runner/);
});
