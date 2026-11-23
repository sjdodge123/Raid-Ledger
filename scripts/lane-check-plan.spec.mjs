// node:test spec for the lane-check planner (ROK-2310).
// Run: node --test scripts/lane-check-plan.spec.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapseFolders, literalsOf, planLaneCheck, removedStrings, toLines } from './lane-check-plan.mjs';

test('a change in api/src/discord-bot/listeners/<file>.ts selects the whole listeners folder', () => {
  const plan = planLaneCheck(['api/src/discord-bot/listeners/voice-state.listener.ts']);
  assert.deepEqual(plan.jest, ['api/src/discord-bot/listeners']);
  assert.deepEqual(plan.typecheck, ['api']);
  assert.deepEqual(plan.eslint, { api: ['src/discord-bot/listeners/voice-state.listener.ts'] });
});

test('a new api spec file selects the api spec typecheck and its folder', () => {
  const plan = planLaneCheck(['api/src/events/signups/new-thing.spec.ts']);
  assert.deepEqual(plan.typecheck, ['api']);
  assert.deepEqual(plan.jest, ['api/src/events/signups']);
});

test('a diff removing a user-visible string yields it in smokeStrings', () => {
  const diff = [
    'diff --git a/web/src/pages/events/header.tsx b/web/src/pages/events/header.tsx',
    '--- a/web/src/pages/events/header.tsx',
    '+++ b/web/src/pages/events/header.tsx',
    '@@ -1,3 +1,3 @@',
    "-  const title = 'Sign up for this raid';",
    "+  const title = 'Join this raid';",
    "   const kept = 'unchanged text here';",
  ].join('\n');
  const plan = planLaneCheck(['web/src/pages/events/header.tsx'], { diff });
  assert.deepEqual(plan.smokeStrings, ['Sign up for this raid']);
});

test('descendant folders collapse into a selected ancestor', () => {
  assert.deepEqual(collapseFolders(['api/src/a/b', 'api/src/a', 'api/src/ab', 'api/src/a/b/c']), ['api/src/a', 'api/src/ab']);
  const plan = planLaneCheck(['web/src/pages/x/y/z.tsx', 'web/src/pages/x/w.tsx']);
  assert.deepEqual(plan.vitest, ['web/src/pages/x']);
});

test('a file directly in api/src or web/src selects related tests, not the whole tree', () => {
  const plan = planLaneCheck(['api/src/app.module.ts', 'web/src/App.tsx']);
  assert.deepEqual(plan.jest, []);
  assert.deepEqual(plan.vitest, []);
  assert.deepEqual(plan.jestRelated, ['api/src/app.module.ts']);
  assert.deepEqual(plan.vitestRelated, ['web/src/App.tsx']);
});

test('packages/contract selects contract tests plus contract, api and web typechecks', () => {
  const plan = planLaneCheck(['packages/contract/src/events.schema.ts']);
  assert.equal(plan.contractTests, true);
  assert.deepEqual(plan.typecheck, ['api', 'contract', 'web']);
  assert.deepEqual(plan.jest, []);
});

test('tools/<x> selects that tool; test-bot also gets eslint', () => {
  const plan = planLaneCheck(['tools/mcp-env/src/x.ts', 'tools/test-bot/src/smoke/a.spec.ts']);
  assert.deepEqual(plan.toolTests, ['mcp-env', 'test-bot']);
  assert.deepEqual(plan.typecheck, ['tool:mcp-env', 'tool:test-bot']);
  assert.deepEqual(plan.eslint, { 'tool:test-bot': ['src/smoke/a.spec.ts'] });
});

test('docs, markdown, .claude and planning-artifacts select nothing', () => {
  const plan = planLaneCheck(['docs/a.md', 'README.md', '.claude/skills/x/SKILL.md', 'planning-artifacts/specs/ROK-1.md']);
  assert.deepEqual(toLines(plan), '');
});

test('a deleted file still selects its typecheck but no folder or eslint run', () => {
  const plan = planLaneCheck(['web/src/gone/old.tsx'], { exists: () => false });
  assert.deepEqual(plan.typecheck, ['web']);
  assert.deepEqual(plan.vitest, []);
  assert.deepEqual(plan.eslint, {});
});

test('literalsOf skips imports, short strings and path-like strings but keeps test ids', () => {
  assert.deepEqual(literalsOf("import { x } from '@raid-ledger/contract';"), []);
  assert.deepEqual(literalsOf("const a = 'short'; const b = './some/path.ts';"), []);
  assert.deepEqual(literalsOf('<button data-testid="signup-confirm-btn">'), ['signup-confirm-btn']);
});

test('literalsOf drops the tail of a nested template (ROK-2301 replay)', () => {
  const line = '  return `${poll} · ${maskedLink(`${hub.label} ${ARROW}`, hub.url)}`;';
  assert.deepEqual(literalsOf(line), []);
  assert.deepEqual(literalsOf('const t = `Vote now (open)`;'), ['Vote now (open)']);
});

test('removedStrings ignores strings re-added elsewhere and removals in test files', () => {
  const diff = [
    '--- a/api/src/x/a.ts', '+++ b/api/src/x/a.ts',
    "-  reply('Moved somewhere else');",
    '--- a/api/src/x/b.ts', '+++ b/api/src/x/b.ts',
    "+  reply('Moved somewhere else');",
    '--- a/api/src/x/a.spec.ts', '+++ b/api/src/x/a.spec.ts',
    "-  expect(t).toBe('Only in a test file');",
  ].join('\n');
  assert.deepEqual(removedStrings(diff), []);
});

test('toLines emits tab-separated rows for the runner', () => {
  const plan = planLaneCheck(['api/src/a/b.ts']);
  assert.equal(toLines(plan), 'typecheck\tapi\njest\tapi/src/a\neslint:api\tsrc/a/b.ts');
});

test('scripts: a .mjs runs its sibling spec, a spec runs itself, a .sh gets bash -n', () => {
  const files = ['scripts/a.mjs', 'scripts/a.spec.mjs', 'scripts/b.sh', 'scripts/c.mjs'];
  const plan = planLaneCheck(files, { exists: (p) => p !== 'scripts/c.spec.mjs' });
  assert.deepEqual(plan.nodeTests, ['scripts/a.spec.mjs']);
  assert.deepEqual(plan.shellParse, ['scripts/b.sh']);
  assert.deepEqual(plan.skipped, ['scripts/c.mjs: no spec or parse check']);
});
