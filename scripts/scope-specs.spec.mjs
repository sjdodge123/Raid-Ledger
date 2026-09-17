// node:test spec for scripts/smoke/scope-specs.sh token mapping (ROK-1603).
//
// Why this exists: the script used to tokenise ONLY a changed file's basename.
// Generic names (utils.ts, index.tsx, types.ts, constants.ts) tokenised to
// nothing and escalated a small web diff to the FULL Playwright tier, even
// when the directory said exactly which surface it belonged to. Now directory
// segments (lfg, scheduling, game-time) are matched first, deepest first, and
// the basename is the fallback. The documented shared-surface ALL triggers and
// "a changed web file that maps to no spec -> ALL" are pinned here too:
// failing toward MORE coverage is the only safe direction for a gate.
//
// Drives the REAL script through its SCOPE_FILES dry-run hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCOPE_SPECS = join(dirname(fileURLToPath(import.meta.url)), 'smoke', 'scope-specs.sh');
const REPO_ROOT = dirname(dirname(dirname(SCOPE_SPECS)));

/** Real scope-specs.sh output lines for a synthetic changed-file list. */
function scopeSpecs(files) {
  return execFileSync('bash', [SCOPE_SPECS], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: { ...process.env, SCOPE_FILES: files.join('\n'), SCOPE_BASE: 'origin/main' },
  })
    .trim()
    .split('\n')
    .filter(Boolean);
}

test('an LFG copy file maps to the LFG specs only, not ALL', () => {
  const out = scopeSpecs(['web/src/pages/lfg/lfg-copy.ts']);

  assert.ok(!out.includes('ALL'), `expected a scoped list, got ${JSON.stringify(out)}`);
  assert.ok(out.length > 0, 'expected at least one LFG spec');
  for (const spec of out) {
    assert.match(spec, /^scripts\/smoke\/lfg-[^/]*\.smoke\.spec\.ts$/);
  }
});

test('a generic utils.ts under scheduling/ maps to the scheduling specs', () => {
  const out = scopeSpecs(['web/src/components/scheduling/utils.ts']);

  assert.ok(!out.includes('ALL'), `a generic basename must not escalate: ${JSON.stringify(out)}`);
  assert.ok(out.includes('scripts/smoke/scheduling-poll.smoke.spec.ts'), JSON.stringify(out));
  for (const spec of out) {
    assert.match(spec, /scheduling/);
  }
});

test('generic basenames (index, types, constants, helpers) defer to the directory', () => {
  for (const name of ['index.ts', 'types.ts', 'constants.ts', 'helpers.ts']) {
    const out = scopeSpecs([`web/src/components/features/game-time/${name}`]);

    assert.ok(!out.includes('ALL'), `${name}: ${JSON.stringify(out)}`);
    assert.ok(out.includes('scripts/smoke/game-time-blocks.smoke.spec.ts'), `${name}: ${JSON.stringify(out)}`);
  }
});

test('web/src/index.css is a shared surface -> ALL', () => {
  assert.deepEqual(scopeSpecs(['web/src/index.css']), ['ALL']);
});

test('the other documented shared surfaces still escalate to ALL', () => {
  for (const f of [
    'web/src/components/layout/Header.tsx',
    'web/src/components/ui/button.tsx',
    'web/src/App.tsx',
    'playwright.config.ts',
    'scripts/smoke/base.ts',
    'scripts/smoke/api-helpers.ts',
  ]) {
    assert.deepEqual(scopeSpecs([f]), ['ALL'], f);
  }
});

test('a web file with only generic path + name tokens is unmappable -> ALL', () => {
  assert.deepEqual(scopeSpecs(['web/src/lib/utils.ts']), ['ALL']);
});

test('one unmappable web file escalates a diff that is otherwise scoped', () => {
  const out = scopeSpecs(['web/src/pages/lfg/lfg-copy.ts', 'web/src/lib/utils.ts']);

  assert.deepEqual(out, ['ALL']);
});

test('a file-specific basename is still used when no directory segment maps', () => {
  const out = scopeSpecs(['web/src/components/lineups/cycle-4/VotingComposite.tsx']);

  assert.ok(!out.includes('ALL'), JSON.stringify(out));
  assert.ok(out.includes('scripts/smoke/lineup-voting-composite.smoke.spec.ts'), JSON.stringify(out));
});

test('output lists each spec once, even when several files map to it', () => {
  const out = scopeSpecs(['web/src/pages/lfg/lfg-copy.ts', 'web/src/pages/lfg/lfg-group-page.tsx']);

  assert.equal(new Set(out).size, out.length, JSON.stringify(out));
});

test('a web file whose tokens map to no spec escalates even beside a mapped one', () => {
  // CLAUDE.md: ALL "when it cannot map a changed file to any spec". The old
  // script only escalated when EVERY token was generic; a specific-but-
  // unmatched name silently dropped out of a scoped run.
  const out = scopeSpecs(['web/src/pages/lfg/lfg-copy.ts', 'web/src/pages/zqxwv/zqxwv-panel.tsx']);

  assert.deepEqual(out, ['ALL']);
});

test('an api file that maps to no spec does not escalate a scoped web diff', () => {
  // The Playwright tier is keyed to web surfaces; api files are best-effort.
  const out = scopeSpecs(['web/src/pages/lfg/lfg-copy.ts', 'api/src/zqxwv/zqxwv.service.ts']);

  assert.ok(!out.includes('ALL'), JSON.stringify(out));
  assert.ok(out.length > 0);
});
