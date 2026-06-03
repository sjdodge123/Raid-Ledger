/**
 * Tests for searchEventsByGame multi-variant fan-out (ROK-1084).
 *
 * Reproduces the prod incident where the DM "Search by Game" flow picked
 * the wrong sibling row from `searchLocalGames` and returned 0 events even
 * though events existed on a sibling gameId. Fix: query the top 5 ranked
 * matches and merge events; update empty copy to multi-id phrasing.
 *
 * These tests will FAIL until events.tree.searchEventsByGame fans out across
 * the top 5 games and uses the new empty-message wording.
 */
import { Logger } from '@nestjs/common';
import { handleEvents } from './events.tree';
import type { AiChatDeps, TreeSession } from './tree.types';

interface FakeGame {
  id: number;
  name: string;
}

interface FindAllArgs {
  gameId?: string;
  page?: number;
  limit?: number;
  upcoming?: string;
}

/** Build a minimal AiChatDeps with only the services exercised by this path. */
function makeDeps(opts: {
  searchLocalGames?: jest.Mock;
  findAll?: jest.Mock;
  viewerTimezone?: string;
  clientUrl?: string | null;
}): AiChatDeps {
  return {
    logger: new Logger('events.tree.spec'),
    eventsService: {
      findAll: opts.findAll ?? jest.fn(),
    } as unknown as AiChatDeps['eventsService'],
    usersService: {} as AiChatDeps['usersService'],
    llmService: {} as AiChatDeps['llmService'],
    settingsService: {
      getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
    } as unknown as AiChatDeps['settingsService'],
    igdbService: {
      searchLocalGames: opts.searchLocalGames ?? jest.fn(),
    } as unknown as AiChatDeps['igdbService'],
    lineupsService: {} as AiChatDeps['lineupsService'],
    schedulingService: {} as AiChatDeps['schedulingService'],
    analyticsService: {} as AiChatDeps['analyticsService'],
    clientUrl:
      opts.clientUrl === undefined
        ? 'https://test.example.com'
        : opts.clientUrl,
    viewerTimezone: opts.viewerTimezone ?? 'UTC',
  };
}

function makeSession(): TreeSession {
  return {
    currentPath: 'events:search',
    isOperator: false,
    userId: 1,
    lastActiveAt: Date.now(),
  };
}

/** Five sibling rows mirroring the prod scenario. id 101 is the row that holds the events. */
const FIVE_GAMES: FakeGame[] = [
  { id: 100, name: 'World of Warcraft' },
  {
    id: 101,
    name: 'World of Warcraft: Burning Crusade Classic - Anniversary Edition',
  },
  { id: 102, name: 'World of Warcraft: Burning Crusade Classic' },
  { id: 103, name: 'World of Warcraft: Wrath of the Lich King Classic' },
  { id: 104, name: 'World of Warcraft Classic' },
];

describe('events.tree — searchEventsByGame fan-out (ROK-1084)', () => {
  it('queries findAll for ALL top-5 ranked games, not just games[0]', async () => {
    const searchLocalGames = jest.fn().mockResolvedValue({
      games: FIVE_GAMES,
      cached: true,
      source: 'local',
    });
    // Every gameId returns no events for this test — we only care that the
    // tree handler asked about every game id, not just games[0].
    const findAll = jest.fn().mockResolvedValue({ data: [], total: 0 });
    const deps = makeDeps({ searchLocalGames, findAll });

    await handleEvents('events:search:world of warcraft', deps, makeSession());

    const calledGameIds = findAll.mock.calls.map(
      ([arg]: [FindAllArgs]) => arg?.gameId,
    );
    // Today the handler only fans out to games[0] (gameId='100'). The fix must
    // call findAll for every top-5 ranked game id.
    expect(calledGameIds).toEqual(
      expect.arrayContaining(['100', '101', '102', '103', '104']),
    );
    expect(findAll).toHaveBeenCalledTimes(5);
  });

  it('merges events from ranked matches when the chosen gameId differs from games[0]', async () => {
    const searchLocalGames = jest.fn().mockResolvedValue({
      games: FIVE_GAMES,
      cached: true,
      source: 'local',
    });
    // Mirrors the prod bug: only the sibling at index 1 (id=101) actually has
    // events. Today's handler only checks games[0] and returns "no events".
    const findAll = jest.fn().mockImplementation(({ gameId }: FindAllArgs) => {
      if (gameId === '101') {
        return Promise.resolve({
          data: [
            {
              id: 7777,
              title: 'BRD Anniversary Run',
              startTime: '2026-05-01T20:00:00.000Z',
            },
          ],
          total: 1,
        });
      }
      return Promise.resolve({ data: [], total: 0 });
    });
    const deps = makeDeps({ searchLocalGames, findAll });

    const result = await handleEvents(
      'events:search:world of warcraft',
      deps,
      makeSession(),
    );

    // The merged response surfaces the seeded event title. Today this
    // assertion fails because games[0] (id=100) returns no events and the
    // handler short-circuits with the static "No upcoming events" message.
    const message = result.emptyMessage ?? result.data ?? '';
    expect(message).toContain('BRD Anniversary Run');
    expect(message.toLowerCase()).toContain('upcoming events');
  });

  it('uses multi-id empty phrasing when no ranked match has events', async () => {
    const searchLocalGames = jest.fn().mockResolvedValue({
      games: FIVE_GAMES,
      cached: true,
      source: 'local',
    });
    const findAll = jest.fn().mockResolvedValue({ data: [], total: 0 });
    const deps = makeDeps({ searchLocalGames, findAll });

    const result = await handleEvents(
      'events:search:world of warcraft',
      deps,
      makeSession(),
    );

    // The new empty copy must reference the search term, not a single
    // matched game name. Today's copy is `No upcoming events for ${games[0].name}`,
    // which mis-attributes the "no results" to a single sibling row and
    // fails this assertion.
    expect(result.emptyMessage).toBe(
      'No upcoming events for any game matching "world of warcraft".',
    );
    expect(result.isLeaf).toBe(true);
  });
});

/** Read the rendered list body from either leaf field. */
function bodyOf(result: { emptyMessage: string | null; data: string | null }) {
  return result.emptyMessage ?? result.data ?? '';
}

describe('events.tree — recipient timezone rendering (ROK-1112)', () => {
  /**
   * 9 PM EDT on 2026-04-23 is 2026-04-24T01:00:00Z. Rendered in the
   * server's UTC default it leaks as 4/24; in America/New_York it must
   * render 4/23 — the date the operator actually scheduled.
   */
  it('renders this-week event dates in the viewer timezone, not UTC', async () => {
    const findAll = jest.fn().mockResolvedValue({
      data: [
        {
          id: 42,
          title: 'EDT Late Night',
          startTime: '2026-04-24T01:00:00.000Z',
        },
      ],
      total: 1,
    });
    const deps = makeDeps({ findAll, viewerTimezone: 'America/New_York' });

    const result = await handleEvents('events:this-week', deps, makeSession());

    const body = bodyOf(result);
    expect(body).toContain('4/23/2026');
    expect(body).not.toContain('4/24/2026');
  });

  it("rolls a 9 PM EDT slot back to the prior day's UTC-crossing date", async () => {
    const findAll = jest.fn().mockResolvedValue({
      data: [
        {
          id: 43,
          title: 'EDT Edge',
          startTime: '2026-04-23T01:00:00.000Z',
        },
      ],
      total: 1,
    });
    const deps = makeDeps({ findAll, viewerTimezone: 'America/New_York' });

    const result = await handleEvents('events:this-week', deps, makeSession());

    expect(bodyOf(result)).toContain('4/22/2026');
  });
});

describe('events.tree — markdown event links (ROK-1112)', () => {
  it('emits a markdown bullet that deep-links the event title', async () => {
    const searchLocalGames = jest.fn().mockResolvedValue({
      games: [{ id: 101, name: 'World of Warcraft' }],
      cached: true,
      source: 'local',
    });
    const findAll = jest.fn().mockResolvedValue({
      data: [
        {
          id: 7777,
          title: 'BRD Anniversary Run',
          startTime: '2026-05-01T20:00:00.000Z',
        },
      ],
      total: 1,
    });
    const deps = makeDeps({ searchLocalGames, findAll });

    const result = await handleEvents(
      'events:search:world of warcraft',
      deps,
      makeSession(),
    );

    const body = bodyOf(result);
    expect(body).toContain(
      '• [BRD Anniversary Run](https://test.example.com/events/7777) —',
    );
  });

  it('falls back to plain text bullets when clientUrl is null', async () => {
    const findAll = jest.fn().mockResolvedValue({
      data: [
        {
          id: 7777,
          title: 'No Link Run',
          startTime: '2026-05-01T20:00:00.000Z',
        },
      ],
      total: 1,
    });
    const deps = makeDeps({ findAll, clientUrl: null });

    const result = await handleEvents('events:this-week', deps, makeSession());

    const body = bodyOf(result);
    expect(body).toContain('• No Link Run —');
    expect(body).not.toContain('](null');
    expect(body).not.toContain('[No Link Run]');
  });

  it('escapes `]` in the title so it cannot break out of the markdown link', async () => {
    const findAll = jest.fn().mockResolvedValue({
      data: [
        {
          id: 7777,
          title: 'Raid ] Night',
          startTime: '2026-05-01T20:00:00.000Z',
        },
      ],
      total: 1,
    });
    const deps = makeDeps({ findAll });

    const result = await handleEvents('events:this-week', deps, makeSession());

    const body = bodyOf(result);
    expect(body).toContain(
      '• [Raid \\] Night](https://test.example.com/events/7777) —',
    );
  });
});
