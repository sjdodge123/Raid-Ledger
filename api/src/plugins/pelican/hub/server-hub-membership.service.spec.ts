/**
 * ROK-1831 fix r1b — the presence writes that must never undo a Leave: the
 * 10-minute "still online" touch and the first roster after boot both pass
 * `rejoin = false`; only a genuine join transition passes `true`.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';
import type { PelicanPresenceSupervisor } from '../presence/pelican-presence.supervisor';
import type { ServerRosterPlayer } from '../presence/server-presence.reader';
import * as queries from './server-hub-membership.queries';
import { ServerHubMembershipService } from './server-hub-membership.service';

jest.mock('./server-hub-membership.queries');
const q = jest.mocked(queries);

const SERVER = 4;
const HUB = 9;
const AT = new Date('2026-10-18T12:00:00Z');

function player(steamId: string, name: string): ServerRosterPlayer {
  return { pelicanServerId: SERVER, steamId, name } as ServerRosterPlayer;
}

/** A service over a fake roster; the db is only handed through to the mocked queries. */
function make(roster: {
  current: ServerRosterPlayer[];
}): ServerHubMembershipService {
  const presence = {
    playersOnGames: () => roster.current,
  } as unknown as PelicanPresenceSupervisor;
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  } as unknown as PostgresJsDatabase<typeof schema>;
  return new ServerHubMembershipService(db, presence);
}

beforeEach(() => {
  jest.resetAllMocks();
  q.hubIdsForServers.mockResolvedValue(new Map([[SERVER, HUB]]));
  q.usersBySteamId.mockImplementation((_db, ids) =>
    Promise.resolve(new Map(ids.map((id) => [id, Number(id)]))),
  );
  q.upsertSighting.mockResolvedValue(undefined);
  q.refreshMemberCount.mockResolvedValue(undefined);
});

describe('touchOnline (L-3 still-online touch)', () => {
  it('writes every linked online player with rejoin=false', async () => {
    const svc = make({
      current: [player('11', 'Bjorn'), player('12', 'Astrid')],
    });
    expect(await svc.touchOnline(AT)).toBe(2);
    expect(q.upsertSighting).toHaveBeenCalledTimes(2);
    for (const call of q.upsertSighting.mock.calls) expect(call[2]).toBe(false);
    expect(q.upsertSighting).toHaveBeenCalledWith(
      expect.anything(),
      { guildId: HUB, userId: 11, characterName: 'Bjorn', at: AT },
      false,
    );
  });
});

const BOOT = { pelicanServerId: SERVER, rehydrated: true } as never;
const LIVE = { pelicanServerId: SERVER } as never;

describe('arrivals after boot (Codex r2 P2: hydration is explicit)', () => {
  it('a non-empty boot roster is a touch; the next join clears left_at', async () => {
    const roster = { current: [player('11', 'Bjorn')] };
    const svc = make(roster);
    await svc.onPresenceChanged(BOOT);
    expect(q.upsertSighting).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 11 }),
      false,
    );
    roster.current = [player('11', 'Bjorn'), player('12', 'Astrid')];
    await svc.onPresenceChanged(LIVE);
    expect(q.upsertSighting).toHaveBeenCalledTimes(2);
    expect(q.upsertSighting).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 12 }),
      true,
    );
  });

  it('an empty boot roster (no hydration event): the first join clears left_at', async () => {
    const roster = { current: [player('12', 'Astrid')] };
    const svc = make(roster);
    await svc.onPresenceChanged(LIVE);
    expect(q.upsertSighting).toHaveBeenCalledTimes(1);
    expect(q.upsertSighting).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 12 }),
      true,
    );
  });

  it('a re-hydration (reactivation) never un-Leaves someone already known', async () => {
    const roster = { current: [player('11', 'Bjorn')] };
    const svc = make(roster);
    await svc.onPresenceChanged(LIVE);
    roster.current = [player('11', 'Bjorn'), player('13', 'Sigrid')];
    await svc.onPresenceChanged(BOOT);
    expect(q.upsertSighting).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 13 }),
      false,
    );
  });
});
