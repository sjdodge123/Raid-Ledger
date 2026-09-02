/**
 * ROK-1460 (slice B) — TDD pins for the scheduled-event lifecycle grammar.
 *
 * One table row per lifecycle state, asserted through `buildEventEmbed`
 * (spec `planning-artifacts/specs/ROK-1460.md` §Grammar per state, AC1–AC5, AC7).
 *
 * The expected chrome state / colour / author line are written out as literals
 * rather than imported from the module under test, so a wrong mapping cannot
 * make the assertion agree with itself.
 */
import {
  DiscordEmbedFactory,
  type EmbedEventData,
  type EmbedContext,
} from './discord-embed.factory';
import { DiscordEmojiService } from './discord-emoji.service';
import { EMBED_STATES, type EmbedState } from '../discord-bot.constants';
import {
  colorForState,
  type EmbedState as ChromeState,
} from '../embeds/embed-chrome.helpers';

const OPEN = '▸'; // ▸
const DOTTED = '◌'; // ◌
const SOLID = '●'; // ●
const SQUARE = '■'; // ■
const CROSS = '✕'; // ✕
const CYCLE = '↻'; // ↻
const SEP = '·'; // ·
const ARROW = '↗'; // ↗
const CALENDAR = '\u{1F4C6}'; // 📆
const ENVELOPE = '✉'; // ✉
/** Canonical personalized field name — DM-only (embed-personalized.helpers.ts). */
const PERSONALIZED_FIELD = '\u{1F3AE} In your library';

const CLIENT_URL = 'http://localhost:5173';
const GAME_ID = 7;
const EVENT_ID = 42;
const START = '2026-02-20T20:00:00.000Z';
const END = '2026-02-20T22:14:00.000Z';

/** Held in a variable so the extra `id` compiles before the dev widens the type. */
const gameFixture = {
  id: GAME_ID,
  name: 'Deep Rock Galactic',
  coverUrl: 'https://example.com/drg.jpg',
};

const baseEvent: EmbedEventData = {
  id: EVENT_ID,
  title: 'Friday Deep Dive',
  startTime: START,
  endTime: END,
  signupCount: 6,
  maxAttendees: 8,
  game: gameFixture,
};

const baseContext: EmbedContext = {
  communityName: 'Test Guild',
  clientUrl: CLIENT_URL,
};

function createFactory(): DiscordEmbedFactory {
  return new DiscordEmbedFactory({
    getRoleEmoji: jest.fn(() => ''),
    getClassEmoji: jest.fn(() => ''),
    isUsingCustomEmojis: jest.fn(() => false),
  } as unknown as DiscordEmojiService);
}

interface Row {
  state: EmbedState;
  /** Frozen clock, so the relative author lines are deterministic. */
  now: string;
  chrome: ChromeState;
  author: string;
  event?: Partial<EmbedEventData>;
  /** Title links to the game detail page unless suppressed (CANCELLED). */
  titleUrl: boolean;
  /** Trailing `[Open event ↗]` line + the 📆 timing line. */
  openLink: boolean;
  calendar: boolean;
  thumbnail: boolean;
  row: boolean;
}

const ROWS: Row[] = [
  {
    state: EMBED_STATES.POSTED,
    now: '2026-02-20T19:40:00.000Z',
    chrome: 'announcing',
    author: `${OPEN} OPEN ${SEP} 6 of 8 signed up`,
    titleUrl: true,
    openLink: true,
    calendar: true,
    thumbnail: true,
    row: true,
  },
  {
    state: EMBED_STATES.FILLING,
    now: '2026-02-20T19:40:00.000Z',
    chrome: 'announcing',
    author: `${DOTTED} FILLING ${SEP} 6 of 8`,
    titleUrl: true,
    openLink: true,
    calendar: true,
    thumbnail: true,
    row: true,
  },
  {
    state: EMBED_STATES.FULL,
    now: '2026-02-20T19:40:00.000Z',
    chrome: 'announcing',
    author: `${SOLID} FULL ${SEP} 8 of 8`,
    event: { signupCount: 8 },
    titleUrl: true,
    openLink: true,
    calendar: true,
    thumbnail: true,
    row: true,
  },
  {
    state: EMBED_STATES.IMMINENT,
    now: '2026-02-20T19:40:00.000Z',
    chrome: 'needs_you',
    author: `${DOTTED} STARTS IN 20 MIN ${SEP} 6 of 8`,
    titleUrl: true,
    openLink: true,
    calendar: true,
    thumbnail: true,
    row: true,
  },
  {
    state: EMBED_STATES.LIVE,
    now: '2026-02-20T20:20:00.000Z',
    chrome: 'live',
    author: `${OPEN} LIVE ${SEP} started 20 min ago`,
    titleUrl: true,
    openLink: true,
    calendar: false,
    thumbnail: true,
    row: true,
  },
  {
    state: EMBED_STATES.COMPLETED,
    now: '2026-02-20T22:20:00.000Z',
    chrome: 'done',
    author: `${SQUARE} ENDED ${SEP} 2h 14m`,
    titleUrl: true,
    openLink: true,
    calendar: false,
    thumbnail: true,
    row: false,
  },
  {
    state: EMBED_STATES.CANCELLED,
    now: '2026-02-20T19:40:00.000Z',
    chrome: 'cancelled',
    author: `${CROSS} CANCELLED`,
    titleUrl: false,
    openLink: false,
    calendar: false,
    thumbnail: false,
    row: false,
  },
  {
    state: EMBED_STATES.RESCHEDULING,
    now: '2026-02-20T19:40:00.000Z',
    chrome: 'needs_you',
    author: `${CYCLE} RESCHEDULING ${SEP} poll open`,
    titleUrl: false,
    openLink: false,
    calendar: false,
    thumbnail: true,
    row: false,
  },
];

function build(row: Row, options: Record<string, unknown> = {}) {
  jest.useFakeTimers({ now: new Date(row.now).getTime() });
  const factory = createFactory();
  const opts = { state: row.state, ...options };
  return factory.buildEventEmbed(
    { ...baseEvent, ...(row.event ?? {}) },
    baseContext,
    opts,
  );
}

afterEach(() => {
  jest.useRealTimers();
});

describe('buildEventEmbed — lifecycle grammar table (AC1)', () => {
  it('exercises every lifecycle state', () => {
    expect(ROWS.map((r) => r.state).sort()).toEqual(
      Object.values(EMBED_STATES).sort(),
    );
  });

  it.each(ROWS.map((r) => [r.state, r] as const))(
    '%s — colour comes from the chrome state',
    (_state, row) => {
      expect(build(row).embed.toJSON().color).toBe(colorForState(row.chrome));
    },
  );

  it.each(ROWS.map((r) => [r.state, r] as const))(
    '%s — author line carries the state and the count',
    (_state, row) => {
      expect(build(row).embed.toJSON().author?.name).toBe(row.author);
    },
  );

  it.each(ROWS.map((r) => [r.state, r] as const))(
    '%s — footer is the community name only (AC2)',
    (_state, row) => {
      expect(build(row).embed.toJSON().footer?.text).toBe('Test Guild');
    },
  );

  it.each(ROWS.map((r) => [r.state, r] as const))(
    '%s — title carries the event title',
    (_state, row) => {
      expect(build(row).embed.toJSON().title).toContain(baseEvent.title);
    },
  );
});

describe('buildEventEmbed — links and art (AC3, AC4)', () => {
  it.each(ROWS.filter((r) => r.titleUrl).map((r) => [r.state, r] as const))(
    '%s — title links to the game detail page',
    (_state, row) => {
      expect(build(row).embed.toJSON().url).toBe(
        `${CLIENT_URL}/games/${GAME_ID}`,
      );
    },
  );

  it.each(ROWS.filter((r) => !r.titleUrl).map((r) => [r.state, r] as const))(
    '%s — title carries no URL',
    (_state, row) => {
      expect(build(row).embed.toJSON().url).toBeUndefined();
    },
  );

  it.each(ROWS.filter((r) => r.openLink).map((r) => [r.state, r] as const))(
    '%s — description ends with the masked open-event link',
    (_state, row) => {
      const desc = build(row).embed.toJSON().description ?? '';
      expect(
        desc.endsWith(`[Open event ${ARROW}](${CLIENT_URL}/events/42)`),
      ).toBe(true);
    },
  );

  it.each(ROWS.filter((r) => r.thumbnail).map((r) => [r.state, r] as const))(
    '%s — keeps the cover art thumbnail',
    (_state, row) => {
      expect(build(row).embed.toJSON().thumbnail?.url).toBeTruthy();
    },
  );

  it('CANCELLED drops the thumbnail (AC4)', () => {
    const row = ROWS.find((r) => r.state === EMBED_STATES.CANCELLED)!;
    expect(build(row).embed.toJSON().thumbnail).toBeUndefined();
  });

  it('omits the open-event link when no client URL is configured', () => {
    jest.useFakeTimers({ now: new Date('2026-02-20T19:40:00.000Z').getTime() });
    const desc = createFactory()
      .buildEventEmbed(baseEvent, { communityName: 'Test Guild' })
      .embed.toJSON().description;
    expect(desc).not.toContain('[Open event');
  });
});

describe('buildEventEmbed — badge thinning (AC5)', () => {
  it.each(ROWS.filter((r) => r.calendar).map((r) => [r.state, r] as const))(
    '%s — keeps the timing line',
    (_state, row) => {
      expect(build(row).embed.toJSON().description).toContain(CALENDAR);
    },
  );

  it.each(ROWS.filter((r) => !r.calendar).map((r) => [r.state, r] as const))(
    '%s — drops the timing line',
    (_state, row) => {
      expect(build(row).embed.toJSON().description ?? '').not.toContain(
        CALENDAR,
      );
    },
  );

  it('COMPLETED reports attendance', () => {
    const row = ROWS.find((r) => r.state === EMBED_STATES.COMPLETED)!;
    const json = build(row).embed.toJSON();
    const rendered = `${json.description ?? ''}\n${(json.fields ?? [])
      .map((f) => `${f.name} ${f.value}`)
      .join('\n')}`;
    expect(rendered).toContain('Attendance');
    expect(rendered).toContain('6 of 8');
  });

  it('CANCELLED explains what was cancelled and who was told', () => {
    const row = ROWS.find((r) => r.state === EMBED_STATES.CANCELLED)!;
    const desc = build(row).embed.toJSON().description ?? '';
    expect(desc).toContain('Was <t:1771617600:f>');
    expect(desc).toContain('6 people were signed up and have been notified.');
  });

  it('RESCHEDULING explains the poll', () => {
    const row = ROWS.find((r) => r.state === EMBED_STATES.RESCHEDULING)!;
    expect(build(row).embed.toJSON().description).toContain(
      'This event is being rescheduled via a scheduling poll.',
    );
  });
});

describe('buildEventEmbed — button rows and push content (AC3)', () => {
  it.each(ROWS.filter((r) => r.row).map((r) => [r.state, r] as const))(
    '%s — attaches the signup row by default',
    (_state, row) => {
      expect(build(row).row).toBeDefined();
    },
  );

  it.each(ROWS.filter((r) => !r.row).map((r) => [r.state, r] as const))(
    '%s — attaches no button row',
    (_state, row) => {
      expect(build(row).row).toBeUndefined();
    },
  );

  it.each(ROWS.filter((r) => r.row).map((r) => [r.state, r] as const))(
    '%s — multiGroup suppresses the row',
    (_state, row) => {
      expect(build(row, { multiGroup: true }).row).toBeUndefined();
    },
  );

  it('RESCHEDULING no longer clears the push content line', () => {
    const row = ROWS.find((r) => r.state === EMBED_STATES.RESCHEDULING)!;
    const { content } = build(row);
    expect(content).toBeDefined();
    expect(content).toBe('\u{1F501} Rescheduling: Friday Deep Dive');
  });
});

describe('buildEventInvite — DM surface variant', () => {
  it('carries the inviter author line', () => {
    const embed = createFactory()
      .buildEventInvite(baseEvent, baseContext, 'roknua')
      .embed.toJSON();
    expect(embed.author?.name).toBe(`${ENVELOPE} INVITED BY roknua`);
  });

  it('footers with the community name only', () => {
    const embed = createFactory()
      .buildEventInvite(baseEvent, baseContext, 'roknua')
      .embed.toJSON();
    expect(embed.footer?.text).toBe('Test Guild');
  });
});

describe('channel embeds refuse a personalized field at write time (AC7)', () => {
  it.each(ROWS.map((r) => [r.state, r] as const))(
    '%s — addFields throws for a DM-only field name',
    (_state, row) => {
      const { embed } = build(row);
      expect(() =>
        embed.addFields({ name: PERSONALIZED_FIELD, value: 'x' }),
      ).toThrow(/personalized/i);
    },
  );
});
