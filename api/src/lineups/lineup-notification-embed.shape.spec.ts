/**
 * ROK-1461 (slice C) — TDD pins for the shape of all NINE lineup builders.
 *
 * CONFIRMED FAILING on the branch base: today every builder returns an action
 * `row`, sets the author to the bare community name, and puts an emoji plus a
 * ` — headline` in the title. The spec
 * (`planning-artifacts/specs/ROK-1461.md`, AC1–AC6) moves all of that onto the
 * shared chrome: state-carrying author line, bare lineup title, and a masked
 * link as the LAST description line instead of a button.
 *
 * Colours are hard-coded hex literals and author lines hard-coded `\u`
 * escapes, so a wrong palette or a wrong grammar cannot make the assertion
 * agree with itself.
 */
import type { EmbedBuilder } from 'discord.js';
import {
  buildCreatedEmbed,
  buildMilestoneEmbed,
  buildVotingOpenEmbed,
  buildDecidedEmbed,
  buildSchedulingEmbed,
  buildEventCreatedEmbed,
  buildTiebreakerStartedEmbed,
  buildTiebreakerReminderEmbed,
  type EmbedContext,
  type MatchSummary,
  type NominationEntry,
} from './lineup-notification-embed.helpers';
import { buildAbortedEmbed } from './lineup-notification-aborted-embed.helpers';

const DIE = '\u{1F3B2}';
const BALLOT = '\u{1F5F3}';
const TROPHY = '\u{1F3C6}';
const CALENDAR = '\u{1F4C5}';
const SOLID = '●';
const SWORDS = '⚔\u{FE0F}';
const DOTTED = '◌';
const STOP = '\u{1F6D1}';
const SEP = '·';
const ARROW = '↗';

/** Palette literals — see file header. */
const ANNOUNCEMENT_CYAN = 0x38bdf8;
const REMINDER_AMBER = 0xf59e0b;
const SIGNUP_EMERALD = 0x34d399;
const ERROR_RED = 0xef4444;

/** Canonical DM-only field name (embed-personalized.helpers.ts). */
const PERSONALIZED_FIELD = '\u{1F3AE} In your library';

const COMMUNITY = 'Test Guild';
const BASE_URL = 'https://raid.example';
const LINEUP_ID = 1;
const MATCH_ID = 7;
const EVENT_ID = 55;
const TITLE = 'September Lineup';
const LINEUP_URL = `${BASE_URL}/community-lineup/${LINEUP_ID}`;

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
const EVENT_DATE = new Date('2026-09-18T19:00:00.000Z');

type WideCtx = EmbedContext & {
  phaseDeadline?: Date;
  nominationCount?: number;
  nominationCap?: number;
  tiebreakerRound?: number;
};

function ctx(overrides: Partial<WideCtx> = {}): EmbedContext {
  const wide: WideCtx = {
    baseUrl: BASE_URL,
    lineupId: LINEUP_ID,
    communityName: COMMUNITY,
    phase: 'nominations',
    lineupTitle: TITLE,
    phaseDeadline: DEADLINE,
    ...overrides,
  };
  return wide;
}

const NOMINATIONS: NominationEntry[] = [
  { gameId: 1, gameName: 'Deep Rock', nominatorName: 'Ana', coverUrl: null },
  { gameId: 2, gameName: 'Valheim', nominatorName: 'Bo', coverUrl: null },
];

const MATCHES: MatchSummary[] = [
  {
    id: 1,
    gameId: 1,
    gameName: 'Deep Rock',
    thresholdMet: true,
    voteCount: 9,
    status: 'scheduling',
  },
  {
    id: 2,
    gameId: 2,
    gameName: 'Valheim',
    thresholdMet: true,
    voteCount: 6,
    status: 'scheduling',
  },
  {
    id: 3,
    gameId: 3,
    gameName: "Baldur's Gate 3",
    thresholdMet: false,
    voteCount: 4,
    status: 'suggested',
  },
  {
    id: 4,
    gameId: 4,
    gameName: 'Lethal Company',
    thresholdMet: false,
    voteCount: 1,
    status: 'suggested',
  },
];

/** Six shown + one collapsed, with a mention-shaped name inside the cap. */
const ROSTER = ['Ana', '<@99>', 'Cy', 'Dee', 'Eli', 'Fay', 'Gil'];

/** Anything a builder may return; `row` is read structurally so this compiles today. */
type BuildResult = { embed: EmbedBuilder; row?: unknown };

interface ShapeRow {
  name: string;
  build: () => BuildResult;
  author: string;
  color: number;
  footerLabel: string;
  lastLine: string;
}

const ROWS: ShapeRow[] = [
  {
    name: 'created',
    build: () => buildCreatedEmbed(ctx()),
    author: `${DIE} NOMINATIONS OPEN ${SEP} closes ${CLOSES_IN}`,
    color: ANNOUNCEMENT_CYAN,
    footerLabel: 'Nominations Open',
    lastLine: `[Nominate a game ${ARROW}](${LINEUP_URL})`,
  },
  {
    name: 'milestone',
    build: () =>
      buildMilestoneEmbed(
        ctx({ nominationCount: 12, nominationCap: 20 }),
        50,
        NOMINATIONS,
      ),
    author: `${DIE} NOMINATIONS OPEN ${SEP} closes ${CLOSES_IN}`,
    color: ANNOUNCEMENT_CYAN,
    footerLabel: 'Nomination Milestone',
    lastLine: `[Nominate a game ${ARROW}](${LINEUP_URL})`,
  },
  {
    name: 'voting open',
    build: () =>
      buildVotingOpenEmbed(ctx({ phase: 'voting' }), [
        { id: 1, name: 'Deep Rock' },
      ]),
    author: `${BALLOT} VOTING OPEN ${SEP} closes ${CLOSES_IN}`,
    color: ANNOUNCEMENT_CYAN,
    footerLabel: 'Voting Open',
    lastLine: `[Cast your votes ${ARROW}](${LINEUP_URL})`,
  },
  {
    name: 'decided',
    build: () => buildDecidedEmbed(ctx({ phase: 'decided' }), MATCHES),
    author: `${TROPHY} MATCHES DECIDED`,
    color: SIGNUP_EMERALD,
    footerLabel: 'Matches Decided',
    lastLine: `[View results ${ARROW}](${LINEUP_URL})`,
  },
  {
    name: 'scheduling',
    build: () =>
      buildSchedulingEmbed(ctx({ phase: 'decided' }), 'Deep Rock', MATCH_ID),
    author: `${CALENDAR} SCHEDULING ${SEP} pick a time`,
    color: ANNOUNCEMENT_CYAN,
    footerLabel: 'Scheduling',
    lastLine: `[Vote on a time ${ARROW}](${LINEUP_URL}/schedule/${MATCH_ID})`,
  },
  {
    name: 'tiebreaker started (bracket)',
    build: () =>
      buildTiebreakerStartedEmbed(
        ctx({ phase: 'voting', tiebreakerRound: 2 }),
        'bracket',
      ),
    author: `${SWORDS} TIEBREAKER ${SEP} round 2`,
    color: ANNOUNCEMENT_CYAN,
    footerLabel: 'Tiebreaker',
    lastLine: `[Vote in bracket ${ARROW}](${LINEUP_URL})`,
  },
  {
    name: 'tiebreaker started (veto)',
    build: () =>
      buildTiebreakerStartedEmbed(
        ctx({ phase: 'voting', tiebreakerRound: 1 }),
        'veto',
      ),
    author: `${SWORDS} TIEBREAKER ${SEP} round 1`,
    color: ANNOUNCEMENT_CYAN,
    footerLabel: 'Tiebreaker',
    lastLine: `[Cast your vetoes ${ARROW}](${LINEUP_URL})`,
  },
  {
    name: 'tiebreaker reminder (bracket)',
    build: () =>
      buildTiebreakerReminderEmbed(
        ctx({ phase: 'voting', phaseDeadline: IN_24H }),
        'bracket',
        IN_24H,
        '24h',
      ),
    author: `${DOTTED} TIEBREAKER ${SEP} closes in 24h`,
    color: REMINDER_AMBER,
    footerLabel: 'Tiebreaker Reminder',
    lastLine: `[Vote in bracket ${ARROW}](${LINEUP_URL})`,
  },
  {
    name: 'tiebreaker reminder (veto)',
    build: () =>
      buildTiebreakerReminderEmbed(
        ctx({ phase: 'voting', phaseDeadline: IN_24H }),
        'veto',
        IN_24H,
        '24h',
      ),
    author: `${DOTTED} TIEBREAKER ${SEP} closes in 24h`,
    color: REMINDER_AMBER,
    footerLabel: 'Tiebreaker Reminder',
    lastLine: `[Cast your vetoes ${ARROW}](${LINEUP_URL})`,
  },
  {
    name: 'aborted',
    build: () => buildAbortedEmbed(ctx(), 'not enough interest', 'Roknua'),
    author: `${STOP} ABORTED`,
    color: ERROR_RED,
    footerLabel: 'Aborted',
    lastLine: `[Open lineup ${ARROW}](${LINEUP_URL})`,
  },
];

/** The event-created builder is listed separately: it carries TWO links. */
function buildEventCreated(eventId?: number): BuildResult {
  return buildEventCreatedEmbed(
    ctx({ phase: 'decided' }),
    'Deep Rock',
    3,
    EVENT_DATE,
    eventId,
    ROSTER,
  );
}

function json(result: BuildResult) {
  return result.embed.toJSON();
}

function lastDescriptionLine(result: BuildResult): string {
  const desc = json(result).description ?? '';
  const lines = desc.trimEnd().split('\n');
  return lines[lines.length - 1];
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW.getTime() });
});

afterEach(() => {
  jest.useRealTimers();
});

const CASES = ROWS.map((r) => [r.name, r] as const);

describe('lineup builders — no button rows (AC2)', () => {
  it.each(CASES)('%s returns no action row', (_name, row) => {
    expect(row.build().row).toBeUndefined();
  });

  it('event created returns no action row', () => {
    expect(buildEventCreated(EVENT_ID).row).toBeUndefined();
  });
});

describe('lineup builders — chrome (AC1)', () => {
  it.each(CASES)('%s author line carries the state', (_name, row) => {
    expect(json(row.build()).author?.name).toBe(row.author);
  });

  it('event created author line carries the state', () => {
    expect(json(buildEventCreated(EVENT_ID)).author?.name).toBe(
      `${SOLID} EVENT CREATED`,
    );
  });

  it.each(CASES)('%s colour comes from the chrome state', (_name, row) => {
    expect(json(row.build()).color).toBe(row.color);
  });

  it('event created is coloured live', () => {
    expect(json(buildEventCreated(EVENT_ID)).color).toBe(SIGNUP_EMERALD);
  });

  it.each(CASES)('%s footer is "community · label"', (_name, row) => {
    expect(json(row.build()).footer?.text).toBe(
      `${COMMUNITY} ${SEP} ${row.footerLabel}`,
    );
  });

  it('event created footer is "community · Event Created"', () => {
    expect(json(buildEventCreated(EVENT_ID)).footer?.text).toBe(
      `${COMMUNITY} ${SEP} Event Created`,
    );
  });
});

describe('lineup builders — bare lineup title (AC4)', () => {
  it.each(CASES)('%s title is the lineup title alone', (_name, row) => {
    expect(json(row.build()).title).toBe(TITLE);
  });

  it('event created title is the lineup title alone', () => {
    expect(json(buildEventCreated(EVENT_ID)).title).toBe(TITLE);
  });
});

describe('lineup builders — masked link is the last line (AC2)', () => {
  it.each(CASES)('%s ends with its masked link', (_name, row) => {
    expect(lastDescriptionLine(row.build())).toBe(row.lastLine);
  });

  it('event created ends with both the event and the lineup link', () => {
    const line = lastDescriptionLine(buildEventCreated(EVENT_ID));
    expect(line).toContain(
      `[Open event ${ARROW}](${BASE_URL}/events/${EVENT_ID})`,
    );
    expect(line).toContain(`[Open lineup ${ARROW}](${LINEUP_URL})`);
    expect(line.startsWith(`[Open event ${ARROW}]`)).toBe(true);
  });

  it('event created without an event id ends with the lineup link alone', () => {
    expect(lastDescriptionLine(buildEventCreated(undefined))).toBe(
      `[Open lineup ${ARROW}](${LINEUP_URL})`,
    );
  });
});

describe('buildMilestoneEmbed — the real nomination cap (AC4)', () => {
  it('reports count of cap, not the percentage threshold', () => {
    const result = buildMilestoneEmbed(
      ctx({ nominationCount: 12, nominationCap: 20 }),
      50,
      NOMINATIONS,
    );
    expect(json(result).description).toContain('12 of 20 nominations filled.');
  });
});

describe('buildDecidedEmbed — Top voted is one line (AC4)', () => {
  function topVotedValue(): string {
    const fields =
      json(buildDecidedEmbed(ctx({ phase: 'decided' }), MATCHES)).fields ?? [];
    const field = fields.find((f) => f.name === `${TROPHY} Top voted`);
    expect(field).toBeDefined();
    return field?.value ?? '';
  }

  it('renders a single line with no newline', () => {
    expect(topVotedValue()).not.toContain('\n');
  });

  it('joins the top three by vote count with a middot', () => {
    const parts = topVotedValue().split(` ${SEP} `);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain('Deep Rock');
    expect(parts[1]).toContain('Valheim');
    expect(parts[2]).toContain("Baldur's Gate 3");
  });
});

describe('buildEventCreatedEmbed — roster via formatRoster (AC5)', () => {
  function rosterValue(): string {
    const fields = json(buildEventCreated(EVENT_ID)).fields ?? [];
    const field = fields.find((f) => f.value.includes('**Ana**'));
    expect(field).toBeDefined();
    return field?.value ?? '';
  }

  it('renders bold display names', () => {
    expect(rosterValue()).toContain('**Ana**');
  });

  it('caps the roster at six and collapses the rest', () => {
    expect(rosterValue()).toContain('+1 more');
  });

  it('never emits a mention', () => {
    expect(rosterValue()).not.toContain('<@');
  });
});

describe('lineup builders — channel guard is live (AC6)', () => {
  it('refuses a personalized field added after the builder returned', () => {
    const { embed } = buildCreatedEmbed(ctx());
    expect(() =>
      embed.addFields({ name: PERSONALIZED_FIELD, value: '142 hrs played' }),
    ).toThrow(/personalized field on channel embed/);
  });
});
