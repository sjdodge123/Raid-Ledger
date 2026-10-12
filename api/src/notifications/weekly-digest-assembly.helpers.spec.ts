/**
 * Unit tests for the v2 weekly-digest assembly (ROK-1771 L6).
 * Pins that every section is assembled, that one failing read empties only
 * its own section or spotlight kind (AC14), that the spotlight goes through
 * `pickSpotlight` with the stored history (AC2/AC3), and that the production
 * wiring calls the existing reads with the ruled options.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import type { GameDetailDto, GameDiscoverRowDto } from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';
import type { LfgGroupAggregate } from '../lfg/lfg-query.helpers';
import * as lfgQuery from '../lfg/lfg-query.helpers';
import * as communityPlaying from '../igdb/igdb-discover-community-playing.helpers';
import * as bestPriceHelpers from './weekly-digest-best-price.helpers';
import * as recapHelpers from './weekly-digest-recap.helpers';
import * as spotlightSources from './weekly-digest-spotlight-sources.helpers';
import {
  assembleDigestSections,
  buildDigestSources,
  type DigestSources,
  type DigestSpotlightContext,
} from './weekly-digest-assembly.helpers';
import { emptyDigestMilestones } from './weekly-digest-milestones.helpers';
import type {
  BossKillsCandidate,
  MarathonCandidate,
} from './weekly-digest-spotlight.helpers';
import type { WeeklyUpcoming } from './weekly-digest-upcoming.helpers';

const RECAP = { eventsRun: 3, playersAttended: 5, attendances: 9 };
const PRIOR = { eventsRun: 1, playersAttended: 2, attendances: 2 };
const WEEK = '2026-W41';
const NO_HISTORY: DigestSpotlightContext = { history: [], week: WEEK };

const MARATHON: MarathonCandidate = {
  kind: 'marathon',
  eventId: 4,
  eventTitle: 'Molten Core',
  durationMinutes: 300,
  attendeeCount: 6,
};
const BOSS: BossKillsCandidate = {
  kind: 'boss_kills',
  instanceName: null,
  killCount: 2,
  firstEverKills: ['Ragnaros'],
};

const UPCOMING: WeeklyUpcoming = {
  events: [
    {
      eventId: 9,
      title: 'Raid night',
      gameName: null,
      startsAt: new Date('2026-10-14T19:00:00Z'),
      signupCount: 4,
    },
  ],
  polls: [],
};

const PLAYING_ROW: GameDiscoverRowDto = {
  category: 'c',
  slug: 's',
  games: [{ id: 1, name: 'Game 1', slug: 'game-1' } as GameDetailDto],
  metadata: { '1': { playerCount: 2, totalSeconds: 1 } },
};

function group(): LfgGroupAggregate {
  return {
    gameId: 7,
    gameName: 'Valheim',
    gameSlug: 'valheim',
    gameCoverUrl: null,
    viabilityThreshold: 4,
    activeCount: 2,
    soonestExpiresAt: new Date('2026-10-13T00:00:00Z'),
    hasOwnIntent: false,
    nowCount: 1,
    soonestNowExpiresAt: null,
  };
}

const none = () => Promise.resolve(null);

function sources(overrides: Partial<DigestSources> = {}): DigestSources {
  return {
    communityPlaying: () => Promise.resolve(PLAYING_ROW),
    recap: () => Promise.resolve(RECAP),
    priorRecap: () => Promise.resolve(PRIOR),
    milestones: () => Promise.resolve(emptyDigestMilestones()),
    upcoming: () => Promise.resolve(UPCOMING),
    spotlight: {
      rising_game: none,
      duo: none,
      boss_kills: () => Promise.resolve(BOSS),
      common_ground: none,
      marathon: () => Promise.resolve(MARATHON),
    },
    lfgGroups: () => Promise.resolve([group()]),
    bestPrice: () => Promise.resolve({ items: [], total: 0 }),
    ...overrides,
  };
}

describe('assembleDigestSections (v2)', () => {
  it('assembles every section; newGameIds stays empty (no prior-week source)', async () => {
    const s = await assembleDigestSections(sources(), NO_HISTORY);
    expect(s.playing.items.map((l) => l.gameId)).toEqual([1]);
    expect(s.recap).toEqual(RECAP);
    expect(s.priorRecap).toEqual(PRIOR);
    expect(s.milestones).toEqual(emptyDigestMilestones());
    expect(s.upcoming).toEqual(UPCOMING);
    expect(s.lfg.items.map((l) => l.gameSlug)).toEqual(['valheim']);
    expect(s.bestPrice).toEqual({ items: [], total: 0 });
    expect(s.newGameIds).toEqual([]);
    expect(s.spotlight?.kind).toBe('boss_kills');
  });

  it('empties only the failing section and reports it (AC14)', async () => {
    const onError = jest.fn();
    const boom = new Error('itad table locked');
    const s = await assembleDigestSections(
      sources({ bestPrice: () => Promise.reject(boom) }),
      NO_HISTORY,
      onError,
    );
    expect(s.bestPrice).toBeNull();
    expect(s.upcoming).toEqual(UPCOMING);
    expect(s.recap).toEqual(RECAP);
    expect(s.spotlight?.kind).toBe('boss_kills');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('bestPrice', boom);
  });

  it('a failing spotlight read drops only that kind; the pick uses the rest', async () => {
    const onError = jest.fn();
    const boom = new Error('pulls table missing');
    const base = sources();
    const s = await assembleDigestSections(
      sources({
        spotlight: {
          ...base.spotlight,
          boss_kills: () => Promise.reject(boom),
        },
      }),
      NO_HISTORY,
      onError,
    );
    expect(s.spotlight?.kind).toBe('marathon');
    expect(onError).toHaveBeenCalledWith('spotlight:boss_kills', boom);
    expect(s.playing.items).toHaveLength(1);
  });
});

describe('assembleDigestSections (v2) — spotlight and null fallbacks', () => {
  it("never repeats last week's spotlight kind (AC3)", async () => {
    const s = await assembleDigestSections(sources(), {
      history: [{ week: '2026-W40', kind: 'boss_kills' }],
      week: WEEK,
    });
    expect(s.spotlight?.kind).toBe('marathon');
  });

  it('failed recaps, milestones and upcoming become null, not a throw', async () => {
    const reject = () => Promise.reject(new Error('db'));
    const s = await assembleDigestSections(
      sources({
        recap: reject,
        priorRecap: reject,
        milestones: reject,
        upcoming: reject,
      }),
      NO_HISTORY,
    );
    expect([s.recap, s.priorRecap, s.milestones, s.upcoming]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });
});

describe('buildDigestSources — production wiring (v2)', () => {
  const db = {} as PostgresJsDatabase<typeof schema>;
  const redis = {} as Redis;

  afterEach(() => jest.restoreAllMocks());

  it('reads this week and the prior week with the opt-out honoured', async () => {
    const spy = jest
      .spyOn(recapHelpers, 'fetchWeeklyRecap')
      .mockResolvedValue(RECAP);
    const built = buildDigestSources(db, redis);
    await built.recap();
    await built.priorRecap();
    expect(spy).toHaveBeenNthCalledWith(1, db, { respectActivityOptOut: true });
    expect(spy).toHaveBeenNthCalledWith(2, db, {
      respectActivityOptOut: true,
      endOffsetDays: 7,
    });
  });

  it('reads Best price from the wishlisted all-time-low read, not v1 deals', async () => {
    const spy = jest
      .spyOn(bestPriceHelpers, 'fetchWishlistedBestPrice')
      .mockResolvedValue({ items: [], total: 0 });
    await buildDigestSources(db, redis).bestPrice();
    expect(spy).toHaveBeenCalledWith(db);
  });

  it('wires each spotlight kind to its own L3 read', async () => {
    const spy = jest
      .spyOn(spotlightSources, 'fetchMarathonCandidate')
      .mockResolvedValue(MARATHON);
    await expect(
      buildDigestSources(db, redis).spotlight.marathon(),
    ).resolves.toEqual(MARATHON);
    expect(spy).toHaveBeenCalledWith(db);
  });

  it('keeps LFG viewer-free and Been playing on the discover cache TTL', async () => {
    const channel = jest
      .spyOn(lfgQuery, 'listActiveGroupsForChannel')
      .mockResolvedValue([]);
    const perViewer = jest.spyOn(lfgQuery, 'listActiveGroups');
    const playing = jest
      .spyOn(communityPlaying, 'fetchCommunityPlayingRow')
      .mockResolvedValue(PLAYING_ROW);
    const built = buildDigestSources(db, redis);
    await built.lfgGroups();
    await built.communityPlaying();
    expect(channel).toHaveBeenCalledWith(db);
    expect(perViewer).not.toHaveBeenCalled();
    expect(playing).toHaveBeenCalledWith(
      db,
      redis,
      expect.objectContaining({ slug: 'community-has-been-playing' }),
      3600,
    );
  });
});
