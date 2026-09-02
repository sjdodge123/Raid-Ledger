/**
 * ROK-1461 (slice C) — TDD pins for the scheduling-poll lifecycle grammar.
 *
 * CONFIRMED FAILING on the branch base: today the poll embed sets its own
 * author (`Test Guild`), its own colour (always ANNOUNCEMENT), a
 * `Scheduling Poll — {game}` title with no URL, a footer that carries the
 * voter count, and a "Vote Now" BUTTON row.
 *
 * The spec (`planning-artifacts/specs/ROK-1461.md` §Files, AC1–AC3, AC6)
 * moves the family onto `createChannelEmbed`: the state lives in the author
 * line, the voter count leaves the footer, the title links `/games/:id`, and
 * the button becomes the last description line.
 *
 * The `locked_in` author timestamp is the TOP-VOTED slot — the slot the embed
 * already renders first and the one lock-in selects. The fixture is built so
 * no other slot could satisfy the assertion.
 */
import {
  DiscordEmbedFactory,
  type EmbedContext,
} from './discord-embed.factory';
import { DiscordEmojiService } from './discord-emoji.service';
import type { SchedulingPollEmbedData } from './discord-embed-scheduling.types';

const OPEN = '▸';
const SOLID = '●';
const SQUARE = '■';
const SEP = '·';
const ARROW = '↗';

/** Palette literals — a wrong mapping cannot agree with itself. */
const ANNOUNCEMENT_CYAN = 0x38bdf8;
const SIGNUP_EMERALD = 0x34d399;
const SYSTEM_SLATE = 0x64748b;

/** Canonical DM-only field name (embed-personalized.helpers.ts). */
const PERSONALIZED_FIELD = '\u{1F3AE} In your library';

const CLIENT_URL = 'http://localhost:5173';
const COMMUNITY = 'Test Guild';
const GAME_ID = 3;
const MATCH_ID = 10;
const LINEUP_ID = 1;
const POLL_URL = `${CLIENT_URL}/community-lineup/${LINEUP_ID}/schedule/${MATCH_ID}`;
const COVER = 'https://img.example.com/elden-ring.jpg';

const TOP_TIME = '2026-04-10T19:00:00.000Z';
const MID_TIME = '2026-04-11T20:00:00.000Z';
const LOW_TIME = '2026-04-12T18:00:00.000Z';

function unix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/** The two fields slice C adds; declared locally so this compiles today. */
type PollStatus = 'open' | 'locked_in' | 'closed';
type WidePollData = SchedulingPollEmbedData & {
  gameId: number;
  status: PollStatus;
  /** ROK-1461 review follow-up: the slot lock-in actually selected. */
  lockedInTime?: string | null;
};

function pollData(
  overrides: Partial<WidePollData> = {},
): SchedulingPollEmbedData {
  return {
    matchId: MATCH_ID,
    lineupId: LINEUP_ID,
    gameId: GAME_ID,
    gameName: 'Elden Ring',
    gameCoverUrl: COVER,
    pollUrl: POLL_URL,
    status: 'open',
    slots: [
      { proposedTime: MID_TIME, voteCount: 4, voterNames: ['Ana'] },
      { proposedTime: TOP_TIME, voteCount: 9, voterNames: ['Bo'] },
      { proposedTime: LOW_TIME, voteCount: 1, voterNames: ['Cy'] },
    ],
    uniqueVoterCount: 5,
    ...overrides,
  };
}

/**
 * ROK-1461 operator walk (2026-09-02): the locked-in time is rendered
 * server-side (Discord ignores `<t:…>` in an author line), so the context
 * pins an IANA zone and the expectations pin the wall-clock string it yields.
 */
const context: EmbedContext = {
  communityName: COMMUNITY,
  clientUrl: CLIENT_URL,
  timezone: 'America/New_York',
};

/** `2026-04-10T19:00Z` and `2026-04-12T18:00Z` in `America/New_York` (EDT). */
const TOP_TIME_LOCAL = 'Apr 10, 3:00 PM EDT';
const LOW_TIME_LOCAL = 'Apr 12, 2:00 PM EDT';

function createFactory(): DiscordEmbedFactory {
  return new DiscordEmbedFactory({
    getRoleEmoji: jest.fn(() => ''),
    getClassEmoji: jest.fn(() => ''),
    isUsingCustomEmojis: jest.fn(() => false),
  } as unknown as DiscordEmojiService);
}

function build(overrides: Partial<WidePollData> = {}) {
  return createFactory().buildSchedulingPollEmbed(pollData(overrides), context);
}

function json(overrides: Partial<WidePollData> = {}) {
  return build(overrides).embed.toJSON();
}

interface StateRow {
  status: PollStatus;
  author: string;
  color: number;
}

const ROWS: StateRow[] = [
  {
    status: 'open',
    author: `${OPEN} POLL OPEN ${SEP} 5 voters`,
    color: ANNOUNCEMENT_CYAN,
  },
  {
    status: 'locked_in',
    author: `${SOLID} LOCKED IN ${SEP} ${TOP_TIME_LOCAL}`,
    color: SIGNUP_EMERALD,
  },
  {
    status: 'closed',
    author: `${SQUARE} POLL CLOSED`,
    color: SYSTEM_SLATE,
  },
];

const CASES = ROWS.map((r) => [r.status, r] as const);

describe('buildSchedulingPollEmbed — lifecycle chrome (AC1, AC3)', () => {
  it.each(CASES)('%s author line carries the state', (_status, row) => {
    expect(json({ status: row.status }).author?.name).toBe(row.author);
  });

  it.each(CASES)('%s colour comes from the chrome state', (_status, row) => {
    expect(json({ status: row.status }).color).toBe(row.color);
  });

  it('singularises a one-voter poll', () => {
    expect(json({ uniqueVoterCount: 1 }).author?.name).toBe(
      `${OPEN} POLL OPEN ${SEP} 1 voter`,
    );
  });

  it.each(CASES)(
    '%s footer is "community · Scheduling Poll"',
    (_status, row) => {
      expect(json({ status: row.status }).footer?.text).toBe(
        `${COMMUNITY} ${SEP} Scheduling Poll`,
      );
    },
  );

  it.each(CASES)(
    '%s footer no longer carries the voter count',
    (_status, row) => {
      expect(json({ status: row.status }).footer?.text).not.toContain('voter');
    },
  );
});

/**
 * ROK-1461 review follow-up (Codex P2): lock-in does NOT have to pick the
 * top-voted slot — an operator can lock any slot, and the linked event's start
 * time is the truth. Announcing the top-voted slot showed the wrong time.
 */
describe('buildSchedulingPollEmbed — locked-in slot is the SELECTED one', () => {
  it('announces the locked-in time, not the top-voted slot', () => {
    const author = json({
      status: 'locked_in',
      lockedInTime: LOW_TIME,
    }).author?.name;
    expect(author).toBe(`${SOLID} LOCKED IN ${SEP} ${LOW_TIME_LOCAL}`);
  });

  it('falls back to the top-voted slot when no locked-in time is carried', () => {
    expect(json({ status: 'locked_in' }).author?.name).toBe(
      `${SOLID} LOCKED IN ${SEP} ${TOP_TIME_LOCAL}`,
    );
  });
});

describe('buildSchedulingPollEmbed — title links the game (AC3)', () => {
  it('asks the question in the title', () => {
    expect(json().title).toBe('When should we play Elden Ring?');
  });

  it('links the title to the game detail page', () => {
    expect(json().url).toBe(`${CLIENT_URL}/games/${GAME_ID}`);
  });
});

describe('buildSchedulingPollEmbed — body (AC2)', () => {
  it('keeps the top three slot lines, highest votes first', () => {
    const desc = json().description ?? '';
    const lines = desc
      .split('\n')
      .filter((l) => l.includes(' votes') || l.includes(' vote'));
    expect(lines).toEqual([
      `<t:${unix(TOP_TIME)}:f> — **9** votes`,
      `<t:${unix(MID_TIME)}:f> — **4** votes`,
      `<t:${unix(LOW_TIME)}:f> — **1** vote`,
    ]);
  });

  it('ends with the masked vote link', () => {
    const desc = (json().description ?? '').trimEnd();
    expect(desc.endsWith(`[Vote now ${ARROW}](${POLL_URL})`)).toBe(true);
  });

  it('keeps the cover art thumbnail', () => {
    expect(json().thumbnail?.url).toBe(COVER);
  });
});

describe('buildSchedulingPollEmbed — no button row (AC2)', () => {
  it.each(CASES)('%s returns no action row', (_status, row) => {
    expect(build({ status: row.status }).row).toBeUndefined();
  });
});

describe('buildSchedulingPollEmbed — channel guard is live (AC6)', () => {
  it('refuses a personalized field added after the builder returned', () => {
    const { embed } = build();
    expect(() =>
      embed.addFields({ name: PERSONALIZED_FIELD, value: '142 hrs played' }),
    ).toThrow(/personalized field on channel embed/);
  });
});
