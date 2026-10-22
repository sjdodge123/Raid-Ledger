// node:test spec for the `validate-ci.sh --scoped` selector (2026-10-22).
//
// The selector decides how little the pre-push gate may check. Two directions
// matter and both are pinned here: a single-workspace diff gets ONLY its own
// workspace, and every CLAUDE.md escalation signal REFUSES with the tier to
// use instead — a narrowed gate that silently passes a migration or a contract
// change is the failure this file exists to prevent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planScopedGate } from './scoped-gate-plan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'scoped-gate-plan.mjs');

/** The targets of an accepted plan; fails loudly on a refusal. */
function targets(files) {
  const plan = planScopedGate(files);
  assert.equal(plan.ok, true, `expected a plan, got refusal: ${plan.reason}`);
  return plan.targets;
}

/** The tier a refusal names; fails loudly when the plan was accepted. */
function refusedWith(files) {
  const plan = planScopedGate(files);
  assert.equal(plan.ok, false, `expected a refusal, got targets: ${plan.targets}`);
  return plan.use;
}

test('a smoke-spec-only diff typechecks the smoke tsconfig and nothing else', () => {
  assert.deepEqual(targets(['scripts/smoke/events.smoke.spec.ts']), ['smoke']);
  assert.deepEqual(targets(['playwright.config.ts']), ['smoke']);
});

test('single-workspace diffs map to that workspace only', () => {
  assert.deepEqual(targets(['api/src/events/events.service.ts']), ['api']);
  assert.deepEqual(targets(['web/src/pages/hub.tsx', 'web/src/pages/hub.test.tsx']), ['web']);
  assert.deepEqual(targets(['tools/mcp-rl-fleet/src/gate-summary.ts']), ['tool:mcp-rl-fleet']);
});

test('docs / planning-artifacts / operator config need nothing', () => {
  assert.deepEqual(
    targets(['docs/runbooks/local-ci-gate.md', 'planning-artifacts/current-sprint.md', '.claude/skills/push/SKILL.md', 'CLAUDE.md']),
    [],
  );
});

test('gate scripts map to the scripts target (shell parse + node:test specs); so do smoke .sh files', () => {
  assert.deepEqual(targets(['scripts/validate-ci.sh', 'scripts/smoke/push-gate.sh']), ['scripts']);
  assert.deepEqual(targets(['scripts/smoke/push-gate.sh', 'scripts/smoke/a.smoke.spec.ts']), ['scripts', 'smoke']);
});

test('smoke non-.ts files feed the smoke tsconfig; ci.yml runs the script specs; the bundle budget runs with web', () => {
  assert.deepEqual(targets(['scripts/smoke/tsconfig.typecheck.json', 'scripts/smoke/fixtures/a.json']), ['smoke']);
  assert.deepEqual(targets(['scripts/smoke/helper.mjs']), ['smoke']);
  assert.deepEqual(targets(['.github/workflows/ci.yml']), ['scripts']);
  assert.deepEqual(targets(['.github/pull_request_template.md']), []);
  assert.deepEqual(targets(['scripts/bundle-budget.config.mjs']), ['web']);
  assert.deepEqual(targets(['scripts/check-bundle-size.mjs']), ['web']);
});

test('a rename out of packages/contract (both sides listed, --no-renames) refuses', () => {
  assert.equal(refusedWith(['packages/contract/src/x.ts', 'api/src/x.ts']), '--static');
});

test('one app workspace plus a tool, smoke or docs stays scoped', () => {
  assert.deepEqual(targets(['api/src/a.ts', 'scripts/smoke/a.smoke.spec.ts', 'docs/x.md']), ['api', 'smoke']);
});

test('every CLAUDE.md escalation signal refuses with the tier to use', () => {
  assert.equal(refusedWith(['packages/contract/src/events.schema.ts']), '--static');
  assert.equal(refusedWith(['packages/contract/ledgerlink/v1/CONTRACT.md']), '--static');
  assert.equal(refusedWith(['api/src/drizzle/migrations/0300_x.sql']), '--full');
  assert.equal(refusedWith(['package-lock.json']), '--full');
  assert.equal(refusedWith(['web/package.json']), '--full');
  assert.equal(refusedWith(['Dockerfile.allinone']), '--full');
  assert.equal(refusedWith(['api/Dockerfile']), '--full');
  assert.equal(refusedWith(['nginx/default.conf']), '--full');
  assert.equal(refusedWith(['docker-entrypoint.sh']), '--full');
});

test('a cross-workspace diff refuses with --static', () => {
  assert.equal(refusedWith(['api/src/a.ts', 'web/src/b.tsx']), '--static');
});

test('root shared config and unknown paths refuse rather than guess', () => {
  assert.equal(refusedWith(['tsconfig.base.json']), '--static');
  assert.equal(refusedWith(['eslint.config.mjs']), '--static');
  assert.equal(refusedWith(['some-new-dir/thing.ts']), '--static');
});

test('an escalation signal wins even when the rest of the diff is docs', () => {
  assert.equal(refusedWith(['docs/a.md', 'api/src/drizzle/migrations/meta/_journal.json']), '--full');
});

test('CLI: prints targets, `none` for a docs-only diff, and exits 3 on a refusal', () => {
  const run = (input) => spawnSync('node', [CLI], { input, encoding: 'utf8' });
  const ok = run('api/src/a.ts\nscripts/smoke/b.smoke.spec.ts\n');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout.trim(), 'api smoke');
  assert.equal(run('docs/a.md\n').stdout.trim(), 'none');
  const refused = run('api/a.ts\nweb/b.tsx\n');
  assert.equal(refused.status, 3);
  assert.match(refused.stderr, /--scoped refused: .*Run validate-ci\.sh --static instead/);
});

test('validate-ci.sh wires --scoped to this selector and rejects conflicting tiers', () => {
  const src = readFileSync(join(HERE, 'validate-ci.sh'), 'utf8');
  assert.match(src, /--scoped\) scoped_mode=true; shift ;;/);
  assert.match(src, /scripts\/scoped-gate-plan\.mjs/);
  for (const flag of ['--static', '--fleet', '--with-e2e']) {
    const r = spawnSync('bash', [join(HERE, 'validate-ci.sh'), '--scoped', flag], {
      encoding: 'utf8',
      env: { ...process.env, RL_TARGET: 'local', BASE_URL: 'https://slot-1.gamernight.net' },
    });
    assert.equal(r.status, 2, `--scoped ${flag}: expected exit 2, got ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /--scoped/);
  }
});
