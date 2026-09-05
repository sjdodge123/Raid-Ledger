/**
 * ROK-1461 (slice C) — TDD pins for the lineup author-line grammar.
 *
 * FAILS BY CONSTRUCTION: `lineup-notification-author.helpers.ts` does not
 * exist yet. This file IS the contract for it — three exports, spelled out in
 * `planning-artifacts/specs/ROK-1461.md` §Files (AC1, AC2, AC4):
 *
 *   lineupAuthorLineFor(kind, ctx) -> the state-carrying author line
 *   lineupChromeState(kind)        -> the chrome state that owns the colour
 *   lineupLink(ctx, label, matchId?) -> the masked link that replaces the button
 *
 * Every expected string is written as an explicit `\u` escape rather than a
 * pasted glyph so a mojibake round-trip cannot quietly weaken the pin, and so
 * the assertion can never agree with a wrong implementation by importing it.
 */
import {
  lineupAuthorLineFor,
  lineupChromeState,
  lineupLink,
  type LineupEmbedKind,
} from './lineup-notification-author.helpers';
import type { EmbedContext } from './lineup-notification-embed.helpers';
import type { EmbedState } from '../discord-bot/embeds/embed-chrome.helpers';

const DIE = '\u{1F3B2}'; // 🎲
const BALLOT = '\u{1F5F3}'; // 🗳 — no VS16 (spec §Files)
const TROPHY = '\u{1F3C6}'; // 🏆
const CALENDAR = '\u{1F4C5}'; // 📅
const SOLID = '●'; // ●
const SWORDS = '⚔\u{FE0F}'; // ⚔️ — WITH VS16 (spec §Files)
const DOTTED = '◌'; // ◌
const STOP = '\u{1F6D1}'; // 🛑
const SEP = '·'; // ·
const ARROW = '↗'; // ↗

const COMMUNITY = 'Test Guild';
const BASE_URL = 'https://raid.example';
const LINEUP_ID = 42;
const MATCH_ID = 7;

/** Frozen clock — the tiebreaker-reminder line is relative to `now`. */
const NOW = new Date('2026-09-10T12:00:00.000Z');
const DEADLINE = new Date('2026-09-12T20:00:00.000Z');
/**
 * ROK-1461 operator walk (2026-09-02): the deadline is rendered as PLAIN TEXT,
 * not `<t:…:R>` markup. Discord renders timestamp markup in an embed's
 * description and fields but NOT in the author line, so the card showed the
 * literal token. `DEADLINE` sits 2d8h past the frozen `NOW`, which the
 * largest-fitting-unit formatter renders as `in 2 days`. Pinned as a literal
 * so the assertion cannot agree with a wrong formatter by importing it.
 */
const CLOSES_IN = 'in 2 days';
const IN_24H = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
const IN_1H = new Date(NOW.getTime() + 60 * 60 * 1000);

/**
 * The context fields slice C adds to `EmbedContext`. Declared locally and cast
 * at the call site so this file compiles against BOTH the current type and the
 * widened one the dev writes.
 */
type AuthorCtx = EmbedContext & {
  phaseDeadline?: Date;
  nominationCount?: number;
  nominationCap?: number;
  tiebreakerRound?: number;
};

function ctx(overrides: Partial<AuthorCtx> = {}): EmbedContext {
  return {
    baseUrl: BASE_URL,
    lineupId: LINEUP_ID,
    communityName: COMMUNITY,
    phase: 'nominations',
    lineupTitle: 'September Lineup',
    ...overrides,
  };
}

interface AuthorRow {
  kind: LineupEmbedKind;
  ctx: Partial<AuthorCtx>;
  expected: string;
}

const AUTHOR_ROWS: AuthorRow[] = [
  {
    kind: 'created',
    ctx: { phaseDeadline: DEADLINE },
    expected: `${DIE} NOMINATIONS OPEN ${SEP} closes ${CLOSES_IN}`,
  },
  { kind: 'created', ctx: {}, expected: `${DIE} NOMINATIONS OPEN` },
  {
    kind: 'milestone',
    ctx: { phaseDeadline: DEADLINE, nominationCount: 12, nominationCap: 20 },
    expected: `${DIE} NOMINATIONS OPEN ${SEP} closes ${CLOSES_IN}`,
  },
  {
    kind: 'voting',
    ctx: { phase: 'voting', phaseDeadline: DEADLINE },
    expected: `${BALLOT} VOTING OPEN ${SEP} closes ${CLOSES_IN}`,
  },
  {
    kind: 'voting',
    ctx: { phase: 'voting' },
    expected: `${BALLOT} VOTING OPEN`,
  },
  {
    kind: 'decided',
    ctx: { phase: 'decided' },
    expected: `${TROPHY} MATCHES DECIDED`,
  },
  {
    kind: 'scheduling',
    ctx: { phase: 'decided' },
    expected: `${CALENDAR} SCHEDULING ${SEP} pick a time`,
  },
  {
    kind: 'event_created',
    ctx: { phase: 'decided' },
    expected: `${SOLID} EVENT CREATED`,
  },
  {
    kind: 'tiebreaker_started',
    ctx: { phase: 'voting', tiebreakerRound: 2 },
    expected: `${SWORDS} TIEBREAKER ${SEP} round 2`,
  },
  {
    kind: 'tiebreaker_started',
    ctx: { phase: 'voting' },
    expected: `${SWORDS} TIEBREAKER ${SEP} round 1`,
  },
  {
    kind: 'tiebreaker_reminder',
    ctx: { phase: 'voting', phaseDeadline: IN_24H },
    expected: `${DOTTED} TIEBREAKER ${SEP} closes in 24h`,
  },
  {
    kind: 'tiebreaker_reminder',
    ctx: { phase: 'voting', phaseDeadline: IN_1H },
    expected: `${DOTTED} TIEBREAKER ${SEP} closes in 1h`,
  },
  { kind: 'aborted', ctx: {}, expected: `${STOP} ABORTED` },
];

const CHROME_ROWS: [LineupEmbedKind, EmbedState][] = [
  ['created', 'announcing'],
  ['milestone', 'announcing'],
  ['voting', 'announcing'],
  ['scheduling', 'announcing'],
  ['tiebreaker_started', 'announcing'],
  ['tiebreaker_reminder', 'needs_you'],
  ['decided', 'live'],
  ['event_created', 'live'],
  ['aborted', 'cancelled'],
];

beforeEach(() => {
  jest.useFakeTimers({ now: NOW.getTime() });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('lineupAuthorLineFor — the state-carrying author line (AC1, AC4)', () => {
  it.each(AUTHOR_ROWS.map((r, i) => [`${i}:${r.kind}`, r] as const))(
    '%s renders the spec grammar verbatim',
    (_label, row) => {
      expect(lineupAuthorLineFor(row.kind, ctx(row.ctx))).toBe(row.expected);
    },
  );

  it.each(CHROME_ROWS.map(([kind]) => kind))(
    '%s never falls back to the bare community name',
    (kind) => {
      expect(lineupAuthorLineFor(kind, ctx())).not.toBe(COMMUNITY);
    },
  );

  it('covers every lineup embed kind', () => {
    const covered = new Set(AUTHOR_ROWS.map((r) => r.kind));
    expect([...covered].sort()).toEqual(CHROME_ROWS.map(([k]) => k).sort());
  });
});

describe('lineupChromeState — kind to the state that owns the colour (AC1)', () => {
  it.each(CHROME_ROWS)('%s maps to %s', (kind, state) => {
    expect(lineupChromeState(kind)).toBe(state);
  });
});

describe('lineupLink — the masked link that replaced the button (AC2)', () => {
  it('links the lineup page with the supplied label', () => {
    expect(lineupLink(ctx(), `Nominate a game ${ARROW}`)).toBe(
      `[Nominate a game ${ARROW}](${BASE_URL}/community-lineup/${LINEUP_ID})`,
    );
  });

  it('escapes a closing bracket so a label cannot break out of the mask', () => {
    expect(lineupLink(ctx(), 'Vote ] now')).toBe(
      `[Vote \\] now](${BASE_URL}/community-lineup/${LINEUP_ID})`,
    );
  });

  it('appends the schedule segment when a match id is supplied', () => {
    expect(lineupLink(ctx(), `Vote on a time ${ARROW}`, MATCH_ID)).toBe(
      `[Vote on a time ${ARROW}](${BASE_URL}/community-lineup/${LINEUP_ID}/schedule/${MATCH_ID})`,
    );
  });
});
