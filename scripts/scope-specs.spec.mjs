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

/**
 * Real scope-specs.sh output lines for a synthetic changed-file list. `diff`
 * (ROK-1792) is the route-file diff text, fed through the SCOPE_DIFF hook;
 * `newFiles` are the files absent at the base (SCOPE_NEW_FILES). Both hooks
 * are always set so no case reads the repo's git state: the fleet runner's
 * /workspace has no usable origin/main.
 */
function scopeSpecs(files, diff = '', newFiles = []) {
  const env = {
    ...process.env,
    SCOPE_FILES: files.join('\n'),
    SCOPE_BASE: 'origin/main',
    SCOPE_DIFF: diff,
    SCOPE_NEW_FILES: newFiles.join('\n'),
  };
  return execFileSync('bash', [SCOPE_SPECS], { encoding: 'utf8', cwd: REPO_ROOT, env })
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
    'web/src/components/layout/Layout.tsx',
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

// ---- ROK-1792: route files and new components/ui files ----------------------

const ROUTES = 'web/src/app-routes.tsx';
const LAZY = 'web/src/lazy-routes.ts';

/** A minimal unified diff for one file from `-`/`+` lines. */
function diffFor(file, lines) {
  return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, '@@ -1 +1 @@', ...lines].join('\n');
}

test('an added /dev/wireframes route maps to NO specs (NONE), not ALL', () => {
  const diff = diffFor(ROUTES, [
    '-  SchedulingWireframesPage, ViewportProbePage,',
    '+  SchedulingWireframesPage, XWireframesPage, ViewportProbePage,',
    '+      <Route path="/dev/wireframes/x" element={<XWireframesPage />} />',
  ]);

  assert.deepEqual(scopeSpecs([ROUTES], diff), ['NONE']);
});

test('a lazy export rendered only on a /dev route maps to NONE (ROK-1774 shape)', () => {
  const diff = [
    diffFor(ROUTES, ['+      <Route path="/dev/wireframes/server-schedule" element={<ServerScheduleWireframesPage />} />']),
    diffFor(LAZY, [
      '+export const ServerScheduleWireframesPage = lazyWithRetry(() =>',
      "+    import('./dev/server-schedule-wireframes/ServerScheduleWireframesPage').then((m) => ({ default: m.ServerScheduleWireframesPage })),",
      '+);',
    ]),
  ].join('\n');

  assert.deepEqual(scopeSpecs([ROUTES, LAZY], diff), ['NONE']);
});

test('an added /guilds/:id route + lazy page map to the guild spec (ROK-1785 shape)', () => {
  const diff = [
    diffFor(ROUTES, [
      '-  GamesPage, CharacterDetailPage,',
      '+  GamesPage, CharacterDetailPage, GuildPage,',
      '+        <Route path="/guilds/:id" element={<GuildPage />} />',
    ]),
    diffFor(LAZY, [
      '+/** ROK-1785: WoW-plugin-owned guild page. */',
      '+export const GuildPage = lazyWithRetry(() =>',
      "+    import('./plugins/wow/guild/guild-page').then((m) => ({ default: m.GuildPage })),",
      '+);',
    ]),
  ].join('\n');

  assert.deepEqual(scopeSpecs([ROUTES, LAZY], diff), ['scripts/smoke/guild-page.smoke.spec.ts']);
});

test('a changed nested (relative) route resolves through its parent path', () => {
  const diff = diffFor(ROUTES, [
    '-      <Route path="gaming/game-time" element={<ProfileGameTimePanel />} />',
    '+      <Route path="gaming/game-time" element={<ProfileGameTimePanel compact />} />',
  ]);
  const out = scopeSpecs([ROUTES], diff);

  assert.ok(!out.includes('ALL') && !out.includes('NONE'), JSON.stringify(out));
  assert.ok(out.includes('scripts/smoke/profile-gaming.smoke.spec.ts'), JSON.stringify(out));
});

test('a removed route escalates to ALL', () => {
  const diff = diffFor(ROUTES, ['-        <Route path="/players" element={<PlayersPage />} />']);

  assert.deepEqual(scopeSpecs([ROUTES], diff), ['ALL']);
});

test('a renamed route escalates to ALL', () => {
  const diff = diffFor(ROUTES, [
    '-        <Route path="/players" element={<PlayersPage />} />',
    '+        <Route path="/members" element={<PlayersPage />} />',
  ]);

  assert.deepEqual(scopeSpecs([ROUTES], diff), ['ALL']);
});

test('an AuthGuard change escalates to ALL', () => {
  const diff = diffFor(ROUTES, [
    '-      <Route element={<AuthGuard />}>',
    '+      <Route element={<AuthGuard requireOnboarding />}>',
  ]);

  assert.deepEqual(scopeSpecs([ROUTES], diff), ['ALL']);
});

test('a pathless layout route or other route-file code escalates to ALL', () => {
  assert.deepEqual(scopeSpecs([ROUTES], diffFor(ROUTES, ['+      <Route element={<Shell />}>'])), ['ALL']);
  assert.deepEqual(scopeSpecs([LAZY], diffFor(LAZY, ['+            window.location.reload();'])), ['ALL']);
});

test('an added route that no spec visits escalates to ALL', () => {
  const diff = diffFor(ROUTES, ['+        <Route path="/zqxwv/:id" element={<ZqxwvPage />} />']);

  assert.deepEqual(scopeSpecs([ROUTES], diff), ['ALL']);
});

test('a route file with no diff escalates to ALL', () => {
  assert.deepEqual(scopeSpecs([ROUTES], ''), ['ALL']);
});

test('a /dev route beside a mapped page lists only the mapped specs', () => {
  const diff = diffFor(ROUTES, ['+      <Route path="/dev/wireframes/x" element={<XWireframesPage />} />']);
  const out = scopeSpecs([ROUTES, 'web/src/pages/lfg/lfg-copy.ts'], diff);

  assert.ok(!out.includes('ALL') && !out.includes('NONE'), JSON.stringify(out));
  for (const spec of out) assert.match(spec, /^scripts\/smoke\/lfg-/);
});

test('a NEW components/ui file that nothing imports yet maps to NONE', () => {
  const f = 'web/src/components/ui/zqxwv-thing.tsx';

  assert.deepEqual(scopeSpecs([f], '', [f]), ['NONE']);
});

test('a changed EXISTING components/ui primitive stays ALL', () => {
  for (const f of ['web/src/components/ui/button.tsx', 'web/src/components/ui/modal.tsx']) {
    assert.deepEqual(scopeSpecs([f]), ['ALL'], f);
  }
});

// ---- Codex P2: structural and import-only route edits keep coverage ---------

test('an import-only swap of a routed component maps to that route, never NONE', () => {
  const diff = diffFor(ROUTES, [
    "-import { EventsPage } from './pages/events-page';",
    "+import { EventsPage } from './pages/events-page-v2';",
  ]);
  const out = scopeSpecs([ROUTES], diff);

  assert.ok(!out.includes('NONE'), `an import swap must not skip Playwright: ${JSON.stringify(out)}`);
  assert.ok(out.includes('scripts/smoke/events.smoke.spec.ts'), JSON.stringify(out));
});

test('a lazy-import module change without a path change maps to the route rendering it', () => {
  const diff = diffFor(LAZY, [
    "-    import('./pages/players-page').then((m) => ({ default: m.PlayersPage })),",
    "+    import('./pages/players-page-v2').then((m) => ({ default: m.PlayersPage })),",
  ]);
  const out = scopeSpecs([LAZY], diff);

  assert.ok(!out.includes('NONE') && !out.includes('ALL'), JSON.stringify(out));
  assert.ok(out.includes('scripts/smoke/players.smoke.spec.ts'), JSON.stringify(out));
});

test('a moved </Route> (re-nesting, e.g. out of AuthGuard) escalates to ALL', () => {
  const diff = diffFor(ROUTES, ['-      </Route>', '+        <Route path="/dev/wireframes/x" element={<XPage />} />', '+      </Route>']);

  assert.deepEqual(scopeSpecs([ROUTES], diff), ['ALL']);
});

test('an import no route renders, a dropped identifier, or a changed module of a list -> ALL', () => {
  const cases = [
    ["+import { useZqxwv } from './hooks/use-zqxwv';"],
    ['-  GamesPage, CharacterDetailPage,', '+  CharacterDetailPage,'],
    ["-} from './lazy-routes';", "+} from './lazy-routes-v2';"],
    ["+import './zqxwv.css';"],
  ];
  for (const lines of cases) {
    assert.deepEqual(scopeSpecs([ROUTES], diffFor(ROUTES, lines)), ['ALL'], JSON.stringify(lines));
  }
});
