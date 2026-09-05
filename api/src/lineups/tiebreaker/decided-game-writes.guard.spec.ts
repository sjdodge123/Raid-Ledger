/**
 * ROK-1374 AC16 — nothing selects a winner without a human.
 *
 * Operator answer Q2: the tool must never pick the game for the group. No coin
 * flip, no highest-ownership tiebreak, no "most recently played", not even as a
 * fallback. That is a rule about the whole codebase, not about one function, so
 * it is enforced the only way a codebase-wide rule can be: by enumerating every
 * site that writes `decided_game_id` and failing when the set changes.
 *
 * A new entry here is not automatically wrong — it means "prove this one is
 * human-initiated, then add it with the reason". The two paths this story adds
 * (the expiry sweep, the round-deadline escalation) must NEVER appear, and are
 * asserted absent by name.
 *
 * Comments are stripped BEFORE matching. `tie-expiry.helpers.ts` explains in
 * prose that it must never write `decidedGameId`, and a guard that matched raw
 * text would flag the file for saying so — this class of test has tripped on
 * its own documentation twice (ROK-1314, memory
 * `feedback_source_scanning_guards_strip_comments`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const API_SRC = resolve(__dirname, '..', '..');
const SKIP_DIRS = new Set(['migrations', 'scripts', 'node_modules']);

/**
 * Every path permitted to write `decided_game_id`, with the human action that
 * authorises it. Derived by running the scan and reading each hit.
 */
const ALLOWED_WRITERS: Record<string, string> = {
  'lineups/lineups-phase.helpers.ts':
    'applyStatusUpdate — copies the winner off an explicit UpdateLineupStatusDto a human (or an operator-triggered transition) supplied.',
  'lineups/lineups-transition.helpers.ts':
    'autoPickDecidedGameId — the UNIQUE top vote-getter. guardTiebreakerOnTransition throws TIEBREAKER_REQUIRED on a tie before this runs, so it never breaks one; it records the group’s own unambiguous result.',
  'lineups/tiebreaker/tiebreaker-decide.helpers.ts':
    'decideLineupFromTiebreaker — the winner a resolved bracket/veto produced, or an operator forceResolve.',
  'lineups/tiebreaker/tiebreaker-detect.helpers.ts':
    'applyTiebreakerWinnerToDto — carries an already-resolved tiebreaker winner into the transition dto.',
  'admin/demo-data-install-lineups.helpers.ts':
    'Demo data install — a seeded fixture lineup, DEMO_MODE only, no real group decision behind it.',
  'lineups/queue/lineup-phase.processor.ts':
    'runGraceTransition — carries tie_pick_game_id, a game the lineup creator or an operator chose by hand (pickTieGame, D15), into the ordinary voting → decided transition; it never derives a winner.',
};

/** Files this story adds that must never acquire the power to decide. */
const FORBIDDEN_WRITERS = [
  'lineups/tiebreaker/tie-expiry.helpers.ts',
  'lineups/tiebreaker/tie-expiry.service.ts',
  'lineups/tiebreaker/tie-escalation.helpers.ts',
  'lineups/tiebreaker/tie-hold.helpers.ts',
];

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) listSourceFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Block comments, then line comments — `://` in a URL is left alone. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** Balanced-paren bodies of every `token` call in `source`. */
function callBodies(source: string, token: string): string[] {
  const bodies: string[] = [];
  let i = source.indexOf(token);
  while (i !== -1) {
    let depth = 0;
    let j = i + token.length - 1;
    for (; j < source.length; j++) {
      if (source[j] === '(') depth++;
      else if (source[j] === ')' && --depth === 0) break;
    }
    bodies.push(source.slice(i, j + 1));
    i = source.indexOf(token, j + 1);
  }
  return bodies;
}

/** True when the comment-stripped source assigns a decided game anywhere. */
export function writesDecidedGameId(strippedSource: string): boolean {
  if (/\bdecidedGameId\s*=[^=]/.test(strippedSource)) return true;
  if (/decided_game_id\s*=[^=]/.test(strippedSource)) return true;
  const payloads = [
    ...callBodies(strippedSource, '.set('),
    ...callBodies(strippedSource, '.values('),
    // ROK-1374: the tie pick travels as a transition argument, not a `.set()`
    // body — a guard that only read `.set(` could not see the one new writer
    // this story introduces.
    ...callBodies(strippedSource, 'runStatusTransition('),
    ...callBodies(strippedSource, 'applyStatusUpdate('),
  ];
  return payloads.some((body) => /\bdecidedGameId\b/.test(body));
}

function scanApiSrc(): string[] {
  return listSourceFiles(API_SRC)
    .filter((file) => writesDecidedGameId(stripComments(readFileSync(file, 'utf8'))))
    .map((file) => relative(API_SRC, file).split(sep).join('/'))
    .sort();
}

describe('AC16 — decided_game_id writers are an enumerated, human-initiated set', () => {
  it('matches the allow-list exactly', () => {
    expect(scanApiSrc()).toEqual(Object.keys(ALLOWED_WRITERS).sort());
  });

  it('never includes the tie hold, its expiry sweep or its escalation', () => {
    const writers = scanApiSrc();
    for (const forbidden of FORBIDDEN_WRITERS) {
      expect(writers).not.toContain(forbidden);
    }
  });

  it('every allow-list entry carries the human action that authorises it', () => {
    for (const [path, reason] of Object.entries(ALLOWED_WRITERS)) {
      expect(reason.length).toBeGreaterThan(40);
      expect(path).toMatch(/\.ts$/);
    }
  });
});

describe('the scanner itself', () => {
  it('strips prose before matching — a file that only DISCUSSES the column is clean', () => {
    const prose = `/** must never carry decidedGameId. */\nexport const x = 1;\n`;
    expect(writesDecidedGameId(stripComments(prose))).toBe(false);
    // The live example: tie-expiry.helpers.ts documents the prohibition.
    const live = readFileSync(join(__dirname, 'tie-expiry.helpers.ts'), 'utf8');
    expect(live).toContain('decidedGameId');
    expect(writesDecidedGameId(stripComments(live))).toBe(false);
  });

  it('flags a real write in any of its three shapes', () => {
    expect(writesDecidedGameId('values.decidedGameId = winner;')).toBe(true);
    expect(writesDecidedGameId(".set({ status: 'decided', decidedGameId: 4 })")).toBe(true);
    expect(writesDecidedGameId('UPDATE community_lineups SET decided_game_id = 4')).toBe(true);
  });

  it('does not flag reads, declarations or comparisons', () => {
    expect(writesDecidedGameId('decidedGameId?: number;')).toBe(false);
    expect(writesDecidedGameId('if (dto.decidedGameId === winner) return;')).toBe(false);
    expect(writesDecidedGameId('select({ gameId: t.decidedGameId })')).toBe(false);
  });
});
