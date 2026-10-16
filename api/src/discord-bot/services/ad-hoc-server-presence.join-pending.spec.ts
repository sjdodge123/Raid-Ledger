/**
 * ROK-1800 x ROK-1801 merge — `joinPending`'s order: the ROK-959 suppression
 * guard runs FIRST (ROK-1800), then the spawn gate sums held server players
 * and voice people (`held + voice < min`, ROK-1801 Q9).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type {
  ServerPresencePlayer,
  ServerPresenceSource,
} from '../../plugins/pelican/presence/server-presence.sink';
import { AdHocServerPresenceService } from './ad-hoc-server-presence.service';
import type { ServerPathVoiceTally } from './ad-hoc-server-voice-tally.service';
import { checkSuppression } from './ad-hoc-spawn-clearance';
import {
  findGameVoiceBinding,
  findLiveGameAdHocEvent,
  listOpenServerPresence,
  listServerEnrolledEvents,
} from './ad-hoc-server-presence.helpers';
import { attachServerPlayer } from './ad-hoc-server-presence.effects';
import {
  buildServerSpawnInput,
  spawnOrFindServerQuickPlay,
} from './ad-hoc-server-spawn.helpers';

jest.mock('./ad-hoc-spawn-clearance', () => ({ checkSuppression: jest.fn() }));
jest.mock('./ad-hoc-server-presence.helpers', () => ({
  ...jest.requireActual<object>('./ad-hoc-server-presence.helpers'),
  findGameVoiceBinding: jest.fn(),
  findLiveGameAdHocEvent: jest.fn(),
  listServerEnrolledEvents: jest.fn(),
  listOpenServerPresence: jest.fn(),
}));
jest.mock('./ad-hoc-server-presence.effects', () => ({
  ...jest.requireActual<object>('./ad-hoc-server-presence.effects'),
  attachServerPlayer: jest.fn(),
}));
jest.mock('./ad-hoc-server-spawn.helpers', () => ({
  ...jest.requireActual<object>('./ad-hoc-server-spawn.helpers'),
  buildServerSpawnInput: jest.fn(),
  spawnOrFindServerQuickPlay: jest.fn(),
}));

const SOURCE: ServerPresenceSource = { gameId: 10, pelicanServerId: 1 };
const PLAYER = {
  steamId: '76561198000000001',
  displayName: null,
} as unknown as ServerPresencePlayer;
const CLEARANCE = { matches: () => true, consume: () => true };
const OTHER = {
  steamId: '76561198000000002',
  displayName: 'Freya',
} satisfies ServerPresencePlayer;
const THIRD = {
  steamId: '76561198000000003',
  displayName: 'Sigrid',
} satisfies ServerPresencePlayer;

function serviceWith(
  voice: number,
  unconfirmed = 0,
): {
  svc: AdHocServerPresenceService;
  countFor: jest.Mock;
} {
  const countFor = jest.fn().mockResolvedValue({ counted: voice, unconfirmed });
  const tally = { countFor } as unknown as ServerPathVoiceTally;
  const deps = [
    {} as PostgresJsDatabase<typeof schema>,
    { isEnabled: () => Promise.resolve(true) },
    {},
    {},
    {},
    {},
    {},
    { emit: jest.fn() },
    tally,
  ] as unknown as ConstructorParameters<typeof AdHocServerPresenceService>;
  return { svc: new AdHocServerPresenceService(...deps), countFor };
}

beforeEach(() => {
  jest.mocked(findLiveGameAdHocEvent).mockResolvedValue(null);
  jest.mocked(findGameVoiceBinding).mockResolvedValue({
    id: 'b1',
    config: { minPlayers: 2 },
  });
  jest.mocked(buildServerSpawnInput).mockResolvedValue(null);
  jest.mocked(listServerEnrolledEvents).mockResolvedValue([]);
});

afterEach(() => jest.resetAllMocks());

describe('AdHocServerPresenceService.joinPending — merge order', () => {
  it('a suppressed game never spawns, however many people are in voice', async () => {
    jest.mocked(checkSuppression).mockResolvedValue(null);
    const { svc, countFor } = serviceWith(9);
    await svc.playerJoined(SOURCE, PLAYER);
    expect(checkSuppression).toHaveBeenCalledTimes(1);
    expect(countFor).not.toHaveBeenCalled();
    expect(buildServerSpawnInput).not.toHaveBeenCalled();
  });

  it('spawns when 1 held server player + 1 voice person reach minPlayers 2', async () => {
    jest
      .mocked(checkSuppression)
      .mockResolvedValue(
        CLEARANCE as unknown as Awaited<ReturnType<typeof checkSuppression>>,
      );
    const { svc } = serviceWith(1);
    await svc.playerJoined(SOURCE, PLAYER);
    expect(buildServerSpawnInput).toHaveBeenCalledTimes(1);
  });

  it('holds when 1 server player + 0 voice is under minPlayers 2', async () => {
    jest
      .mocked(checkSuppression)
      .mockResolvedValue(
        CLEARANCE as unknown as Awaited<ReturnType<typeof checkSuppression>>,
      );
    const { svc } = serviceWith(0);
    await svc.playerJoined(SOURCE, PLAYER);
    expect(buildServerSpawnInput).not.toHaveBeenCalled();
  });

  it('1 held server player + 1 presence-null voice person waits for the delayed spawn (Codex r3 P2)', async () => {
    jest
      .mocked(checkSuppression)
      .mockResolvedValue(
        CLEARANCE as unknown as Awaited<ReturnType<typeof checkSuppression>>,
      );
    const { svc } = serviceWith(1, 1);
    await svc.playerJoined(SOURCE, PLAYER);
    expect(buildServerSpawnInput).not.toHaveBeenCalled();
  });
});

describe('AdHocServerPresenceService — held players across a session restart (ROK-1802)', () => {
  beforeEach(() => {
    jest
      .mocked(checkSuppression)
      .mockResolvedValue(
        CLEARANCE as unknown as Awaited<ReturnType<typeof checkSuppression>>,
      );
  });

  /** The steamIds of the players handed to each spawn attempt. */
  const spawned = () =>
    jest
      .mocked(buildServerSpawnInput)
      .mock.calls.map(([, , , players]) => players.map((p) => p.steamId));

  it('a held player whose join fell outside the replay counts once a heartbeat covers the count', async () => {
    const { svc } = serviceWith(0);
    await svc.playerJoined(SOURCE, PLAYER);
    await svc.openPresence(SOURCE);
    await svc.playerJoined(SOURCE, OTHER);
    expect(spawned()).toEqual([]); // unconfirmed: no count vouches yet
    await svc.playerCount(SOURCE, 2);
    expect(spawned()).toEqual([[PLAYER.steamId, OTHER.steamId]]);
  });

  it('a held player who left while the plugin was stopped is never enrolled (the count excludes them)', async () => {
    const { svc } = serviceWith(0);
    await svc.playerJoined(SOURCE, PLAYER);
    await svc.openPresence(SOURCE);
    await svc.playerJoined(SOURCE, OTHER);
    await svc.playerCount(SOURCE, 1);
    expect(spawned()).toEqual([]);
    // A later heartbeat cannot bring the dropped hold back.
    await svc.playerCount(SOURCE, 5);
    await svc.playerJoined(SOURCE, THIRD);
    expect(spawned()).toEqual([[OTHER.steamId, THIRD.steamId]]);
  });

  it('a replay that re-reports the held player re-confirms them without a heartbeat', async () => {
    const { svc } = serviceWith(0);
    await svc.playerJoined(SOURCE, PLAYER);
    await svc.openPresence(SOURCE);
    await svc.playerJoined(SOURCE, PLAYER);
    await svc.playerJoined(SOURCE, OTHER);
    expect(spawned()).toEqual([[PLAYER.steamId, OTHER.steamId]]);
  });

  it('a hold that survives (no session restart) still reaches the threshold', async () => {
    const { svc } = serviceWith(0);
    await svc.playerJoined(SOURCE, PLAYER);
    await svc.playerJoined(SOURCE, OTHER);
    expect(spawned()).toEqual([[PLAYER.steamId, OTHER.steamId]]);
  });
});

describe('AdHocServerPresenceService — a heartbeat after a spawn (ROK-1802 Codex r2)', () => {
  beforeEach(() => {
    jest
      .mocked(checkSuppression)
      .mockResolvedValue(
        CLEARANCE as unknown as Awaited<ReturnType<typeof checkSuppression>>,
      );
  });

  it('a stale hold is not covered by players already enrolled on the server (Codex r2)', async () => {
    const live = { id: 77, channelBindingId: 'b1', adHocStatus: 'live' };
    const input = { gameId: 10, pelicanServerId: 1 };
    jest
      .mocked(buildServerSpawnInput)
      .mockResolvedValue(
        input as unknown as Awaited<ReturnType<typeof buildServerSpawnInput>>,
      );
    jest
      .mocked(spawnOrFindServerQuickPlay)
      .mockResolvedValue({ kind: 'existing', live });
    const { svc } = serviceWith(0);
    await svc.playerJoined(SOURCE, PLAYER); // A, held below minPlayers 2
    await svc.openPresence(SOURCE); // A unconfirmed; A left meanwhile
    await svc.playerJoined(SOURCE, OTHER);
    await svc.playerJoined(SOURCE, THIRD); // B + C reach 2 → enrolled
    // B and C now sit on the server as enrolled rows; the count is theirs.
    jest.mocked(listServerEnrolledEvents).mockResolvedValue([live]);
    jest.mocked(listOpenServerPresence).mockResolvedValue([OTHER, THIRD]);
    jest.mocked(findLiveGameAdHocEvent).mockResolvedValue(live);
    await svc.playerCount(SOURCE, 2);
    const attached = jest
      .mocked(attachServerPlayer)
      .mock.calls.map(([, , , pl]) => pl.steamId);
    expect(attached).toEqual([OTHER.steamId, THIRD.steamId]);
  });
});
