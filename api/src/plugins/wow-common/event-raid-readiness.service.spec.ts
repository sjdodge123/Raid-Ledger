/**
 * ROK-1926 AC2 — raid readiness reads everything in batched loads: the
 * number of loader calls (and of resolver passes) is the same for one signup
 * as for five, and the service never queries the db itself. A per-signup
 * query (N+1) shows up as a loader called N times or a direct db touch.
 */
import { Test } from '@nestjs/testing';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { GuildAccessService } from '../../guilds/guild-access.service';
import { loadEventQuestSet } from './event-forever-progress.query';
import type { ReadinessSignup } from './event-quest-readiness.helpers';
import {
  hasActiveSignup,
  loadEventManualRows,
  loadReadinessEvent,
  loadReadinessRoster,
} from './event-quest-readiness.query';
import { EventRaidReadinessService } from './event-raid-readiness.service';
import { assertCanReadEvent } from './event-readiness.access';
import { WowFactsService } from './facts/wow-facts.service';
import { loadForeverCharSnapshot } from './forever-char-snapshot.query';
import { loadForeverQuestSources } from './forever-quest-source.query';
import { loadRosterMemberIds } from './guilds/guild-roster.helpers';
import { WOW_FOREVER_GAME_SLUG } from './wow-forever-identity.helpers';

jest.mock('./event-forever-progress.query');
jest.mock('./event-quest-readiness.query');
jest.mock('./event-readiness.access');
jest.mock('./forever-char-snapshot.query');
jest.mock('./forever-quest-source.query');
jest.mock('./guilds/guild-roster.helpers');

const DB_METHODS = ['select', 'insert', 'update', 'delete', 'execute'];
const dbTouches: string[] = [];
const db = new Proxy(
  {},
  {
    get(_target, key) {
      if (DB_METHODS.includes(String(key))) dbTouches.push(String(key));
      return undefined;
    },
  },
);
const resolveFacts = jest.fn();

const signup = (i: number): ReadinessSignup => ({
  userId: i,
  username: `user${i}`,
  characterId: `char-${i}`,
  characterName: `Char${i}`,
  charClass: 'Warrior',
  charRace: 'Human',
});

async function readinessFor(count: number) {
  const signups = Array.from({ length: count }, (_, i) => signup(i + 1));
  jest.mocked(loadReadinessEvent).mockResolvedValue({
    title: 'Molten Core Night',
    duration: [new Date('2026-11-08T20:00Z'), new Date('2026-11-08T23:00Z')],
    guildId: 7,
    slug: WOW_FOREVER_GAME_SLUG,
    contentInstances: [],
  });
  jest.mocked(assertCanReadEvent).mockResolvedValue(undefined);
  jest.mocked(loadEventQuestSet).mockResolvedValue({
    eventQuests: [],
    lookup: new Map(),
    knownIds: new Set(),
  });
  jest.mocked(loadReadinessRoster).mockResolvedValue(signups);
  jest.mocked(loadEventManualRows).mockResolvedValue([]);
  jest.mocked(loadForeverQuestSources).mockResolvedValue(new Map());
  jest.mocked(loadRosterMemberIds).mockResolvedValue(new Map());
  resolveFacts.mockResolvedValue({ facts: new Map(), truncated: false });
  const moduleRef = await Test.createTestingModule({
    providers: [
      EventRaidReadinessService,
      { provide: DrizzleAsyncProvider, useValue: db },
      { provide: GuildAccessService, useValue: {} },
      { provide: WowFactsService, useValue: { resolveFacts } },
    ],
  }).compile();
  const service = moduleRef.get(EventRaidReadinessService);
  return service.readiness({ id: 1, role: 'admin' }, 42);
}

describe('EventRaidReadinessService — batched loads (ROK-1926 AC2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dbTouches.length = 0;
  });

  it.each([1, 5])('runs each load once for %i signup(s)', async (count) => {
    const body = await readinessFor(count);
    expect(body.signups).toHaveLength(count);
    for (const loader of [
      loadReadinessEvent,
      loadEventQuestSet,
      loadReadinessRoster,
      loadEventManualRows,
      loadForeverQuestSources,
      loadRosterMemberIds,
    ]) {
      expect(jest.mocked(loader)).toHaveBeenCalledTimes(1);
    }
    expect(resolveFacts).toHaveBeenCalledTimes(1);
    expect(jest.mocked(loadForeverCharSnapshot)).not.toHaveBeenCalled();
    expect(jest.mocked(hasActiveSignup)).not.toHaveBeenCalled();
    expect(dbTouches).toEqual([]);
  });
});
