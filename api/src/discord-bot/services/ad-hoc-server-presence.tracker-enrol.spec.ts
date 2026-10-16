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
  listOnServerSteamIds,
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
  listServerEnrolledEvents: jest.fn(),
  listOnServerSteamIds: jest.fn(),
}));
jest.mock('./ad-hoc-server-presence.effects', () => ({
  ...jest.requireActual<object>('./ad-hoc-server-presence.effects'),
  attachServerPlayer: jest.fn(),
}));

const SOURCE: ServerPresenceSource = { gameId: 10, pelicanServerId: 1 };
const ROK = '76561198000000001';
const LIVE = { id: 278, channelBindingId: 'b1', adHocStatus: 'live' };
const ON_SERVER: ServerRosterPlayer = { ...SOURCE, steamId: ROK, name: 'rok' };

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
  jest.mocked(listOnServerSteamIds).mockResolvedValue([]);
  jest.mocked(listServerEnrolledEvents).mockResolvedValue([]);
  jest.mocked(checkSuppression).mockResolvedValue(null);
});

afterEach(() => jest.resetAllMocks());

describe('AdHocServerPresenceService — tracker enrolment (ROK-1821)', () => {
  it('a voice-born spawn gives a server-only tracker player an on-server row', async () => {
    const svc = serviceWith([ON_SERVER]);
    await svc.onParticipantJoined({ eventId: 278, userId: 5 });
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

  it('a player whose row is already open on that server is not attached again', async () => {
    jest.mocked(listOnServerSteamIds).mockResolvedValue([ROK]);
    const svc = serviceWith([ON_SERVER]);
    await svc.onParticipantJoined({ eventId: 278, userId: 5 });
    expect(attachServerPlayer).not.toHaveBeenCalled();
  });

  it('a held player left unconfirmed by a re-auth is still enrolled while the tracker reports them', async () => {
    jest.mocked(findLiveGameAdHocEvent).mockResolvedValueOnce(null);
    const svc = serviceWith([ON_SERVER]);
    await svc.playerJoined(SOURCE, { steamId: ROK, displayName: 'rok' });
    await svc.openPresence(SOURCE); // re-auth: the hold is now unconfirmed
    await svc.onParticipantJoined({ eventId: 278, userId: 5 });
    expect(attachServerPlayer).toHaveBeenCalledTimes(1);
    expect(await svc.heldPresence(SOURCE)).toEqual([]);
  });

  it('the voice-leave safety net enrols tracked players and answers true', async () => {
    const svc = serviceWith([ON_SERVER]);
    await expect(
      svc.onTrackerEnrol({ eventId: 278, gameId: 10 }),
    ).resolves.toBe(true);
    expect(attachServerPlayer).toHaveBeenCalledTimes(1);
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
