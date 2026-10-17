/**
 * ROK-1821 (RCA F1, missing tests 1 and 3) — a live Quick Play takes every
 * player the server TRACKER reports for its game, not only eligible holds:
 * a voice-born event enrols a server-only player, an unconfirmed hold (a
 * re-auth, no new lines for >10 min) still gets enrolled, and a player whose
 * row is already open is not attached twice.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type {
  ServerPresenceReader,
  ServerRosterPlayer,
} from '../../plugins/pelican/presence/server-presence.reader';
import type { ServerPresenceSource } from '../../plugins/pelican/presence/server-presence.sink';
import { AdHocServerPresenceService } from './ad-hoc-server-presence.service';
import { checkSuppression } from './ad-hoc-spawn-clearance';
import { getEventById } from './ad-hoc-event.helpers';
import {
  findLiveGameAdHocEvent,
  hasOpenServerPlayers,
  listOpenGameServerSteamIds,
  listOpenServerPresence,
  listServerEnrolledEvents,
} from './ad-hoc-server-presence.helpers';
import { attachServerPlayer } from './ad-hoc-server-presence.effects';

jest.mock('./ad-hoc-spawn-clearance', () => ({ checkSuppression: jest.fn() }));
jest.mock('./ad-hoc-event.helpers', () => ({
  ...jest.requireActual<object>('./ad-hoc-event.helpers'),
  getEventById: jest.fn(),
}));
jest.mock('./ad-hoc-server-presence.helpers', () => ({
  ...jest.requireActual<object>('./ad-hoc-server-presence.helpers'),
  findLiveGameAdHocEvent: jest.fn(),
  hasOpenServerPlayers: jest.fn(),
  listOpenGameServerSteamIds: jest.fn(),
  listServerEnrolledEvents: jest.fn(),
  listOpenServerPresence: jest.fn(),
}));
jest.mock('./ad-hoc-server-presence.effects', () => ({
  ...jest.requireActual<object>('./ad-hoc-server-presence.effects'),
  attachServerPlayer: jest.fn(),
}));

const SOURCE: ServerPresenceSource = { gameId: 10, pelicanServerId: 1 };
const ROK = '76561198000000001';
const LIVE = { id: 278, channelBindingId: 'b1', adHocStatus: 'live' };
const ON_SERVER: ServerRosterPlayer = { ...SOURCE, steamId: ROK, name: 'rok' };
/** A voice join: `addParticipant` always names the Discord member. */
const VOICE_JOIN = { eventId: 278, userId: 5, discordUserId: 'discord-5' };
/** A server-row join: `addServerParticipant` / a server-born spawn — no Discord id. */
const SERVER_JOIN = { eventId: 278, userId: 5 };

function readerOf(players: ServerRosterPlayer[]): ServerPresenceReader {
  return {
    playersOnGames: () => players,
    playersForGame: (g) => players.filter((p) => p.gameId === g),
  };
}

function serviceWith(
  players: ServerRosterPlayer[],
): AdHocServerPresenceService {
  const deps = [
    {} as PostgresJsDatabase<typeof schema>,
    { isEnabled: () => Promise.resolve(true) },
    {},
    {},
    {},
    {},
    {},
    { emit: jest.fn() },
    null,
    { get: () => readerOf(players) },
  ] as unknown as ConstructorParameters<typeof AdHocServerPresenceService>;
  return new AdHocServerPresenceService(...deps);
}

const eventRow = (over: object = {}) =>
  ({
    ...LIVE,
    gameId: 10,
    cancelledAt: null,
    ...over,
  }) as unknown as Awaited<ReturnType<typeof getEventById>>;

beforeEach(() => {
  jest.mocked(getEventById).mockResolvedValue(eventRow());
  jest.mocked(findLiveGameAdHocEvent).mockResolvedValue(LIVE);
  jest.mocked(listOpenServerPresence).mockResolvedValue([]);
  jest.mocked(listServerEnrolledEvents).mockResolvedValue([]);
  jest.mocked(listOpenGameServerSteamIds).mockResolvedValue([]);
  jest.mocked(checkSuppression).mockResolvedValue(null);
});

afterEach(() => jest.resetAllMocks());

describe('AdHocServerPresenceService — tracker enrolment (ROK-1821)', () => {
  it('a voice-born spawn gives a server-only tracker player an on-server row', async () => {
    const svc = serviceWith([ON_SERVER]);
    await svc.onParticipantJoined(VOICE_JOIN);
    expect(attachServerPlayer).toHaveBeenCalledWith(
      expect.anything(),
      LIVE,
      1,
      {
        steamId: ROK,
        displayName: 'rok',
      },
    );
  });

  it("a tracker enrol carries the named player's character owner (ROK-1828)", async () => {
    const owned = { ...ON_SERVER, characterOwnerId: 'zdo-owner-1' };
    const svc = serviceWith([owned]);
    await svc.onParticipantJoined(VOICE_JOIN);
    expect(attachServerPlayer).toHaveBeenCalledWith(
      expect.anything(),
      LIVE,
      1,
      {
        steamId: ROK,
        displayName: 'rok',
        characterOwnerId: 'zdo-owner-1',
      },
    );
  });

  it('a player whose row is already open on that server is not attached again', async () => {
    jest.mocked(listOpenGameServerSteamIds).mockResolvedValue([ROK]);
    const svc = serviceWith([ON_SERVER]);
    await svc.onParticipantJoined(VOICE_JOIN);
    expect(attachServerPlayer).not.toHaveBeenCalled();
  });

  it('a player open in ANOTHER live Quick Play of the game is not copied into this one', async () => {
    // The game-wide read spans every live event of game 10, not only `LIVE`.
    jest.mocked(listOpenGameServerSteamIds).mockResolvedValue([ROK]);
    const svc = serviceWith([ON_SERVER]);
    await svc.onParticipantJoined(VOICE_JOIN);
    expect(attachServerPlayer).not.toHaveBeenCalled();
    expect(listOpenGameServerSteamIds).toHaveBeenCalledWith(
      expect.anything(),
      10,
    );
  });

  it('a player who moved servers keeps their row: open on server 1, tracked on server 2 (Codex r2 P2)', async () => {
    jest.mocked(listOpenGameServerSteamIds).mockResolvedValue([ROK]);
    const moved = { ...ON_SERVER, pelicanServerId: 2 };
    const svc = serviceWith([moved]);
    await svc.onParticipantJoined(VOICE_JOIN);
    // Re-attaching would overwrite the row's pelicanServerId with 2.
    expect(attachServerPlayer).not.toHaveBeenCalled();
  });

  it('a player the tracker lists on two servers is attached once', async () => {
    const svc = serviceWith([ON_SERVER, { ...ON_SERVER, pelicanServerId: 2 }]);
    await svc.onParticipantJoined(VOICE_JOIN);
    expect(attachServerPlayer).toHaveBeenCalledTimes(1);
  });

  it("a player enrolled while handling another's join is not attached again by their own queued join (Codex r3)", async () => {
    const B = '76561198000000002';
    const open = new Set<string>();
    jest
      .mocked(listOpenGameServerSteamIds)
      .mockImplementation(() => Promise.resolve([...open]));
    jest.mocked(attachServerPlayer).mockImplementation((_fx, _live, _s, pl) => {
      open.add(pl.steamId);
      return Promise.resolve();
    });
    const svc = serviceWith([
      ON_SERVER,
      { ...ON_SERVER, steamId: B, name: 'b' },
    ]);
    await svc.playerJoined(SOURCE, { steamId: ROK, displayName: 'rok' });
    await svc.playerJoined(SOURCE, { steamId: B, displayName: 'b' });
    const attachedB = jest
      .mocked(attachServerPlayer)
      .mock.calls.filter(([, , , pl]) => pl.steamId === B);
    // B attached once: one session (sessionCount 1), not two.
    expect(attachedB).toHaveLength(1);
  });

  it('an explicit join on server 2 moves a player still open on server 1 (Codex r4)', async () => {
    // Open on server 1 only: the game-wide read sees them, server 2's does not.
    jest
      .mocked(listOpenGameServerSteamIds)
      .mockImplementation((_db, _game, serverId) =>
        Promise.resolve(serverId === 2 ? [] : [ROK]),
      );
    const svc = serviceWith([{ ...ON_SERVER, pelicanServerId: 2 }]);
    await svc.playerJoined(
      { ...SOURCE, pelicanServerId: 2 },
      { steamId: ROK, displayName: 'rok' },
    );
    expect(jest.mocked(attachServerPlayer).mock.calls).toEqual([
      [expect.anything(), LIVE, 2, { steamId: ROK, displayName: 'rok' }],
    ]);
  });

  it('a held player left unconfirmed by a re-auth is still enrolled while the tracker reports them', async () => {
    jest.mocked(findLiveGameAdHocEvent).mockResolvedValueOnce(null);
    const svc = serviceWith([ON_SERVER]);
    await svc.playerJoined(SOURCE, { steamId: ROK, displayName: 'rok' });
    await svc.openPresence(SOURCE); // re-auth: the hold is now unconfirmed
    await svc.onParticipantJoined(VOICE_JOIN);
    expect(attachServerPlayer).toHaveBeenCalledTimes(1);
    expect(await svc.heldPresence(SOURCE)).toEqual([]);
  });

  it('a server-row PARTICIPANT_JOINED does not trigger the enrol pass (ROK-1822)', async () => {
    const svc = serviceWith([ON_SERVER]);
    await svc.onParticipantJoined(SERVER_JOIN);
    expect(jest.mocked(getEventById).mock.calls).toEqual([]);
    expect(jest.mocked(findLiveGameAdHocEvent).mock.calls).toEqual([]);
    expect(jest.mocked(attachServerPlayer).mock.calls).toEqual([]);
  });

  it('a discord voice join still runs the enrol pass (ROK-1822)', async () => {
    const svc = serviceWith([ON_SERVER]);
    await svc.onParticipantJoined(VOICE_JOIN);
    expect(jest.mocked(findLiveGameAdHocEvent).mock.calls).toEqual([
      [expect.anything(), 10],
    ]);
    expect(attachServerPlayer).toHaveBeenCalledTimes(1);
  });

  it('the voice-leave safety net enrols tracked players and answers true', async () => {
    jest.mocked(hasOpenServerPlayers).mockResolvedValue(true);
    const svc = serviceWith([ON_SERVER]);
    await expect(
      svc.onTrackerEnrol({ eventId: 278, gameId: 10 }),
    ).resolves.toBe(true);
    expect(attachServerPlayer).toHaveBeenCalledTimes(1);
  });

  it('the safety net answers false when the event is no longer live', async () => {
    jest.mocked(hasOpenServerPlayers).mockResolvedValue(true);
    jest
      .mocked(getEventById)
      .mockResolvedValue(eventRow({ adHocStatus: 'ended' }));
    const svc = serviceWith([ON_SERVER]);
    await expect(
      svc.onTrackerEnrol({ eventId: 278, gameId: 10 }),
    ).resolves.toBe(false);
    expect(attachServerPlayer).not.toHaveBeenCalled();
  });

  it('the safety net answers false when the tracked player left before the enrol ran', async () => {
    const players = [ON_SERVER];
    jest.mocked(getEventById).mockImplementation(() => {
      players.length = 0; // the leave landed while the enrol waited its turn
      return Promise.resolve(eventRow());
    });
    jest.mocked(hasOpenServerPlayers).mockResolvedValue(false);
    const svc = serviceWith(players);
    await expect(
      svc.onTrackerEnrol({ eventId: 278, gameId: 10 }),
    ).resolves.toBe(false);
    expect(attachServerPlayer).not.toHaveBeenCalled();
    expect(hasOpenServerPlayers).toHaveBeenCalledWith(expect.anything(), 278);
  });

  it('an unbound reader (ModuleRef.get throws) reads as nobody tracked', async () => {
    const deps = [
      {} as PostgresJsDatabase<typeof schema>,
      ...Array.from({ length: 7 }, () => ({})),
      null,
      {
        get: () => {
          throw new Error('Nest could not find SERVER_PRESENCE_READER');
        },
      },
    ] as unknown as ConstructorParameters<typeof AdHocServerPresenceService>;
    const svc = new AdHocServerPresenceService(...deps);
    await expect(
      svc.onTrackerEnrol({ eventId: 278, gameId: 10 }),
    ).resolves.toBe(false);
    expect(getEventById).not.toHaveBeenCalled();
  });

  it('the safety net answers false when the tracker reports nobody', async () => {
    const svc = serviceWith([]);
    await expect(
      svc.onTrackerEnrol({ eventId: 278, gameId: 10 }),
    ).resolves.toBe(false);
    expect(getEventById).not.toHaveBeenCalled();
  });
});
