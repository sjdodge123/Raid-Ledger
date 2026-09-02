/**
 * ROK-1460 (slice B) — TDD pins for the scheduled-event chrome helpers.
 *
 * Target module: `discord-embed-event-chrome.helpers.ts` (does not exist yet).
 * Contract under test (spec `planning-artifacts/specs/ROK-1460.md`, §Files + §Grammar):
 *
 *   lifecycleToChromeState(EmbedState) -> EmbedState (chrome, 5 values)
 *   authorLineFor(state, event)        -> the author line for that state
 *   gameDetailUrl(clientUrl, gameId)   -> `${clientUrl}/games/${gameId}` | null
 *   openEventLink(clientUrl, eventId, label?) -> `[Open event ↗](url)` | null
 */
import {
  lifecycleToChromeState,
  authorLineFor,
  gameDetailUrl,
  openEventLink,
} from './discord-embed-event-chrome.helpers';
import type { EmbedEventData } from './discord-embed.factory';
import { EMBED_STATES, type EmbedState } from '../discord-bot.constants';
import type { EmbedState as ChromeState } from '../embeds/embed-chrome.helpers';

/** Author-line glyphs, spelled out so a mojibake diff is readable. */
const OPEN = '\u25B8'; // ▸
const DOTTED = '\u25CC'; // ◌
const SOLID = '\u25CF'; // ●
const SQUARE = '\u25A0'; // ■
const CROSS = '\u2715'; // ✕
const CYCLE = '\u21BB'; // ↻
const SEP = '\u00B7'; // ·
const ARROW = '\u2197'; // ↗

const START = '2026-02-20T20:00:00.000Z';
/** start + 2h14m — the design sheet's `■ ENDED · 2h 14m` example. */
const END = '2026-02-20T22:14:00.000Z';

function makeEvent(overrides: Partial<EmbedEventData> = {}): EmbedEventData {
  return {
    id: 42,
    title: 'Friday Deep Dive',
    startTime: START,
    endTime: END,
    signupCount: 6,
    maxAttendees: 8,
    game: { id: 7, name: 'Deep Rock Galactic', coverUrl: null },
    ...overrides,
  };
}

/** Freeze the clock so the relative author lines are deterministic. */
function freezeAt(iso: string): void {
  jest.useFakeTimers({ now: new Date(iso).getTime() });
}

afterEach(() => {
  jest.useRealTimers();
});

describe('lifecycleToChromeState — 8 lifecycle states collapse onto 5 chrome states', () => {
  const CASES: Array<[EmbedState, ChromeState]> = [
    [EMBED_STATES.POSTED, 'announcing'],
    [EMBED_STATES.FILLING, 'announcing'],
    [EMBED_STATES.FULL, 'announcing'],
    [EMBED_STATES.IMMINENT, 'needs_you'],
    [EMBED_STATES.RESCHEDULING, 'needs_you'],
    [EMBED_STATES.LIVE, 'live'],
    [EMBED_STATES.COMPLETED, 'done'],
    [EMBED_STATES.CANCELLED, 'cancelled'],
  ];

  it.each(CASES)('maps %s to the %s chrome state', (lifecycle, chrome) => {
    expect(lifecycleToChromeState(lifecycle)).toBe(chrome);
  });

  it('covers every lifecycle state (no silent default swallowing a new one)', () => {
    expect(CASES.map(([lifecycle]) => lifecycle).sort()).toEqual(
      Object.values(EMBED_STATES).sort(),
    );
  });
});

describe('authorLineFor — the state-carrying author line (spec §Grammar)', () => {
  it('POSTED renders the open line with the signed-up suffix', () => {
    expect(
      authorLineFor(EMBED_STATES.POSTED, makeEvent({ signupCount: 3 })),
    ).toBe(`${OPEN} OPEN ${SEP} 3 of 8 signed up`);
  });

  it('POSTED without a max drops the "of {max}" segment', () => {
    expect(
      authorLineFor(
        EMBED_STATES.POSTED,
        makeEvent({ signupCount: 3, maxAttendees: null }),
      ),
    ).toBe(`${OPEN} OPEN ${SEP} 3 signed up`);
  });

  it('FILLING renders the bare count pair', () => {
    expect(
      authorLineFor(EMBED_STATES.FILLING, makeEvent({ signupCount: 3 })),
    ).toBe(`${DOTTED} FILLING ${SEP} 3 of 8`);
  });

  it('FULL renders max of max', () => {
    expect(
      authorLineFor(EMBED_STATES.FULL, makeEvent({ signupCount: 8 })),
    ).toBe(`${SOLID} FULL ${SEP} 8 of 8`);
  });

  it('IMMINENT counts down the minutes to start', () => {
    freezeAt('2026-02-20T19:40:00.000Z'); // start - 20m
    expect(authorLineFor(EMBED_STATES.IMMINENT, makeEvent())).toBe(
      `${DOTTED} STARTS IN 20 MIN ${SEP} 6 of 8`,
    );
  });

  it('LIVE counts up from the start time and carries no roster count', () => {
    freezeAt('2026-02-20T20:20:00.000Z'); // start + 20m
    expect(authorLineFor(EMBED_STATES.LIVE, makeEvent())).toBe(
      `${OPEN} LIVE ${SEP} started 20 min ago`,
    );
  });

  it('COMPLETED renders the scheduled duration', () => {
    expect(authorLineFor(EMBED_STATES.COMPLETED, makeEvent())).toBe(
      `${SQUARE} ENDED ${SEP} 2h 14m`,
    );
  });

  it('CANCELLED renders the bare badge with no count', () => {
    expect(authorLineFor(EMBED_STATES.CANCELLED, makeEvent())).toBe(
      `${CROSS} CANCELLED`,
    );
  });

  it('RESCHEDULING announces the open poll', () => {
    expect(authorLineFor(EMBED_STATES.RESCHEDULING, makeEvent())).toBe(
      `${CYCLE} RESCHEDULING ${SEP} poll open`,
    );
  });

  it('never falls back to the bare community name for any state', () => {
    freezeAt('2026-02-20T19:40:00.000Z');
    for (const state of Object.values(EMBED_STATES)) {
      const line = authorLineFor(state, makeEvent());
      expect(line).not.toBe('Raid Ledger');
      expect(line.length).toBeGreaterThan(0);
    }
  });
});

describe('gameDetailUrl — the title link target (spec §Links)', () => {
  it('builds the id-based game detail route', () => {
    expect(gameDetailUrl('http://localhost:5173', 7)).toBe(
      'http://localhost:5173/games/7',
    );
  });

  it('returns null without a client URL', () => {
    expect(gameDetailUrl(null, 7)).toBeNull();
    expect(gameDetailUrl(undefined, 7)).toBeNull();
    expect(gameDetailUrl('', 7)).toBeNull();
  });

  it('returns null without a game id', () => {
    expect(gameDetailUrl('http://localhost:5173', null)).toBeNull();
    expect(gameDetailUrl('http://localhost:5173', undefined)).toBeNull();
  });
});

describe('openEventLink — the trailing masked link (spec §Links)', () => {
  it('renders the default masked link', () => {
    expect(openEventLink('http://localhost:5173', 42)).toBe(
      `[Open event ${ARROW}](http://localhost:5173/events/42)`,
    );
  });

  it('escapes a "]" in the label so it cannot break out of the mask', () => {
    expect(openEventLink('http://localhost:5173', 42, 'Vote now ]evil')).toBe(
      '[Vote now \\]evil](http://localhost:5173/events/42)',
    );
  });

  it('returns null without a client URL', () => {
    expect(openEventLink(null, 42)).toBeNull();
    expect(openEventLink(undefined, 42)).toBeNull();
    expect(openEventLink('', 42)).toBeNull();
  });
});
