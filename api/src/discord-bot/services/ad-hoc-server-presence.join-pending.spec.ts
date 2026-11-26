/**
 * ROK-1800 x ROK-1801 merge — `joinPending`'s order: the ROK-959 suppression
 * guard runs FIRST (ROK-1800), then the spawn gate sums held server players
 * and voice people (`held + voice < min`, ROK-1801 Q9).
 */
import { steamPlayer } from '../../plugins/pelican/presence/presence-events';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type {
  ServerPresencePlayer,
  ServerPresenceSource,
} from '../../plugins/pelican/presence/server-presence.sink';
import { AdHocServerPresenceService } from './ad-hoc-server-presence.service';
import type { ServerPathVoiceTally } from './ad-hoc-server-voice-tally.service';
import { checkSuppression } from './ad-hoc-spawn-clearance';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import {
  findGameVoiceBinding,
  findLiveGameAdHocEvent,
  listOpenGameServerPlayerKeys,
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
  listOpenGameServerPlayerKeys: jest.fn(),
  listServerEnrolledEvents: jest.fn(),
  listOpenServerPresence: jest.fn(),
}));
jest.mock('./ad-hoc-server-presence.effects', () => ({
  ...jest.requireActual<object>('./ad-hoc-server-presence.effects'),
  attachServerPlayer: jest.fn(),
  // Codex r9 P2: a created spawn's post-commit side effects stay inert here.
  announceServerSpawn: jest.fn(),
}));
jest.mock('./ad-hoc-server-enrol.helpers', () => ({
  ...jest.requireActual<object>('./ad-hoc-server-enrol.helpers'),
  enrolGame: jest.fn(),
}));
jest.mock('./ad-hoc-server-spawn.helpers', () => ({
  ...jest.requireActual<object>('./ad-hoc-server-spawn.helpers'),
  buildServerSpawnInput: jest.fn(),
  spawnOrFindServerQuickPlay: jest.fn(),
}));

const SOURCE: ServerPresenceSource = { gameId: 10, pelicanServerId: 1 };
const PLAYER = {
  ...steamPlayer('76561198000000001'),
  displayName: null,
} as unknown as ServerPresencePlayer;
const CLEARANCE = { matches: () => true, consume: () => true };
const OTHER = {
  ...steamPlayer('76561198000000002'),
  displayName: 'Freya',
} satisfies ServerPresencePlayer;
const THIRD = {
  ...steamPlayer('76561198000000003'),
  displayName: 'Sigrid',
} satisfies ServerPresencePlayer;

function serviceWith(
  voice: number,
  unconfirmed = 0,
  moduleRef: unknown = null,
): {
  svc: AdHocServerPresenceService;
  countFor: jest.Mock;
  emit: jest.Mock;
} {
  const countFor = jest.fn().mockResolvedValue({ counted: voice, unconfirmed });
  const emit = jest.fn();
  const tally = { countFor } as unknown as ServerPathVoiceTally;
  const deps = [
    {} as PostgresJsDatabase<typeof schema>,
    { isEnabled: () => Promise.resolve(true) },
    {},
    {},
    {},
    {},
    {},
    { emit },
    tally,
    moduleRef,
  ] as unknown as ConstructorParameters<typeof AdHocServerPresenceService>;
  return { svc: new AdHocServerPresenceService(...deps), countFor, emit };
}

beforeEach(() => {
  jest.mocked(findLiveGameAdHocEvent).mockResolvedValue(null);
  jest.mocked(findGameVoiceBinding).mockResolvedValue({
    id: 'b1',
    config: { minPlayers: 2 },
  });
  jest.mocked(buildServerSpawnInput).mockResolvedValue(null);
  jest.mocked(listServerEnrolledEvents).mockResolvedValue([]);
  jest.mocked(listOpenGameServerPlayerKeys).mockResolvedValue([]);
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

  // Codex r9 P2: a created (not joined) server Quick Play is announced
  // post-commit so the channel lifecycle nudge hears about it.
  it('announces a created server Quick Play for the lifecycle nudge', async () => {
    jest
      .mocked(checkSuppression)
      .mockResolvedValue(
        CLEARANCE as unknown as Awaited<ReturnType<typeof checkSuppression>>,
      );
    jest.mocked(buildServerSpawnInput).mockResolvedValue({
      gameId: 10,
      pelicanServerId: 1,
      bindingId: null,
      creatorId: 7,
      players: [],
      ids: [],
    });
    jest
      .mocked(spawnOrFindServerQuickPlay)
      .mockResolvedValue({ kind: 'created', eventId: 55, joined: [] });
    const { svc, emit } = serviceWith(1);
    await svc.playerJoined(SOURCE, PLAYER);
    expect(emit).toHaveBeenCalledWith('ad-hoc.quick-play.created', {
      eventId: 55,
      gameId: 10,
    });
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

  /** The player ids of the players handed to each spawn attempt. */
  const spawned = () =>
    jest
      .mocked(buildServerSpawnInput)
      .mock.calls.map(([, , , players]) => players.map((p) => p.playerId));

  it('a held player whose join fell outside the replay counts once a heartbeat covers the count', async () => {
    const { svc } = serviceWith(0);
    await svc.playerJoined(SOURCE, PLAYER);
    await svc.openPresence(SOURCE);
    await svc.playerJoined(SOURCE, OTHER);
    expect(spawned()).toEqual([]); // unconfirmed: no count vouches yet
    await svc.playerCount(SOURCE, 2);
    expect(spawned()).toEqual([[PLAYER.playerId, OTHER.playerId]]);
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
    expect(spawned()).toEqual([[OTHER.playerId, THIRD.playerId]]);
  });

  it('a replay that re-reports the held player re-confirms them without a heartbeat', async () => {
    const { svc } = serviceWith(0);
    await svc.playerJoined(SOURCE, PLAYER);
    await svc.openPresence(SOURCE);
    await svc.playerJoined(SOURCE, PLAYER);
    await svc.playerJoined(SOURCE, OTHER);
    expect(spawned()).toEqual([[PLAYER.playerId, OTHER.playerId]]);
  });

  it('a hold that survives (no session restart) still reaches the threshold', async () => {
    const { svc } = serviceWith(0);
    await svc.playerJoined(SOURCE, PLAYER);
    await svc.playerJoined(SOURCE, OTHER);
    expect(spawned()).toEqual([[PLAYER.playerId, OTHER.playerId]]);
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
      .mock.calls.map(([, , , pl]) => pl.playerId);
    expect(attached).toEqual([OTHER.playerId, THIRD.playerId]);
  });

  it("a reconnected, enrolled player's own hold never takes the heartbeat's cover slot (Codex r3)", async () => {
    const live = { id: 77, channelBindingId: 'b1', adHocStatus: 'live' };
    const { svc } = serviceWith(0);
    // A then B held (no spawn input), then a reopen leaves both unconfirmed.
    await svc.playerJoined(SOURCE, PLAYER);
    await svc.playerJoined(SOURCE, OTHER);
    await svc.openPresence(SOURCE);
    // A live event appears; B reconnects and is enrolled, its hold kept.
    jest.mocked(findLiveGameAdHocEvent).mockResolvedValue(live);
    await svc.playerJoined(SOURCE, OTHER);
    jest.mocked(listServerEnrolledEvents).mockResolvedValue([live]);
    jest.mocked(listOpenServerPresence).mockResolvedValue([OTHER]);
    // Two on the server: enrolled B plus held A — A is covered.
    await svc.playerCount(SOURCE, 2);
    const attached = jest
      .mocked(attachServerPlayer)
      .mock.calls.map(([, , , pl]) => pl.playerId);
    expect(attached).toEqual([OTHER.playerId, PLAYER.playerId]);
  });
});

/** A plugin host whose Pelican state the test flips (no event emitted). */
function pluginHost(): { moduleRef: unknown; setActive: (v: boolean) => void } {
  let active = true;
  const registry = {
    isActive: (slug: string): boolean => slug === 'pelican' && active,
  };
  const get = (token: unknown): unknown =>
    token === PluginRegistryService ? registry : undefined;
  return { moduleRef: { get }, setActive: (v) => (active = v) };
}

describe('AdHocServerPresenceService — Pelican turned off (ROK-2355)', () => {
  const held = async (
    moduleRef: unknown = null,
  ): Promise<AdHocServerPresenceService> => {
    jest
      .mocked(checkSuppression)
      .mockResolvedValue(
        CLEARANCE as unknown as Awaited<ReturnType<typeof checkSuppression>>,
      );
    const { svc } = serviceWith(0, 0, moduleRef);
    await svc.playerJoined(SOURCE, OTHER);
    expect(await svc.heldPresence(SOURCE)).toEqual([OTHER]);
    return svc;
  };

  it('drops every below-threshold hold when Pelican deactivates', async () => {
    const svc = await held();
    await svc.onPluginDeactivated({ slug: 'pelican' });
    expect(await svc.heldPresence(SOURCE)).toEqual([]);
  });

  it('refuses a hold that lands after Pelican deactivates (a queued session call)', async () => {
    const svc = await held();
    await svc.onPluginDeactivated({ slug: 'pelican' });
    jest.mocked(checkSuppression).mockClear();
    await svc.playerJoined(SOURCE, PLAYER);
    expect(await svc.heldPresence(SOURCE)).toEqual([]);
    expect(checkSuppression).not.toHaveBeenCalled();
  });

  it('holds again once Pelican is reactivated', async () => {
    const svc = await held();
    await svc.onPluginDeactivated({ slug: 'pelican' });
    svc.onPluginActivated({ slug: 'pelican' });
    await svc.playerJoined(SOURCE, PLAYER);
    expect(await svc.heldPresence(SOURCE)).toEqual([PLAYER]);
  });

  it('an evaluate in flight at deactivation spawns from its holds, never from an emptied set (Codex P2)', async () => {
    let release: (v: unknown) => void = () => undefined;
    let reached: () => void = () => undefined;
    const atGate = new Promise<void>((r) => (reached = r));
    jest.mocked(checkSuppression).mockImplementation(() => {
      reached();
      return new Promise((r) => (release = r));
    });
    const { svc } = serviceWith(1); // 1 held + 1 in voice = minPlayers 2
    const join = svc.playerJoined(SOURCE, PLAYER);
    await atGate;
    const off = svc.onPluginDeactivated({ slug: 'pelican' });
    release(CLEARANCE);
    await Promise.all([join, off]);
    const spawnedWith = jest
      .mocked(buildServerSpawnInput)
      .mock.calls.map(([, , , players]) => players);
    expect(spawnedWith).toEqual([[PLAYER]]);
    expect(await svc.heldPresence(SOURCE)).toEqual([]);
  });

  it('holds again after deactivate -> uninstall -> install, which emits no ACTIVATED (review r2 M1)', async () => {
    const host = pluginHost();
    const svc = await held(host.moduleRef);
    host.setActive(false);
    await svc.onPluginDeactivated({ slug: 'pelican' });
    await svc.playerJoined(SOURCE, PLAYER);
    expect(await svc.heldPresence(SOURCE)).toEqual([]);
    host.setActive(true); // install: active row, INSTALLED only
    await svc.playerJoined(SOURCE, PLAYER);
    expect(await svc.heldPresence(SOURCE)).toEqual([PLAYER]);
  });

  it('a reactivation during the drain keeps the holds made since (review r2 m1)', async () => {
    let release: (v: unknown) => void = () => undefined;
    let reached: () => void = () => undefined;
    const atGate = new Promise<void>((r) => (reached = r));
    jest
      .mocked(checkSuppression)
      .mockResolvedValue(
        CLEARANCE as unknown as Awaited<ReturnType<typeof checkSuppression>>,
      )
      .mockImplementationOnce(() => {
        reached();
        return new Promise((r) => (release = r));
      });
    const { svc } = serviceWith(0);
    const slow = svc.playerJoined(SOURCE, PLAYER); // game 10 stuck at the gate
    await atGate;
    const off = svc.onPluginDeactivated({ slug: 'pelican' });
    svc.onPluginActivated({ slug: 'pelican' });
    const other: ServerPresenceSource = { gameId: 20, pelicanServerId: 2 };
    await svc.playerJoined(other, OTHER);
    release(CLEARANCE);
    await Promise.all([slow, off]);
    expect(await svc.heldPresence(other)).toEqual([OTHER]);
  });

  it('keeps the holds when another plugin deactivates', async () => {
    const svc = await held();
    await svc.onPluginDeactivated({ slug: 'valheim' });
    expect(await svc.heldPresence(SOURCE)).toEqual([OTHER]);
  });
});
