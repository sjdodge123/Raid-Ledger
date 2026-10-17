/**
 * ROK-1801 layer B — every operator ruling on the lobby merge as a named case.
 */
import type { LobbyGameGroup } from './voice-lobby-groups.helpers';
import { partitionLobbyGroups } from './voice-lobby-groups.helpers';
import {
  groupSize,
  mergeServerPresence,
  serverGameOf,
  serverOnlySummary,
} from './voice-lobby-server-merge.helpers';
import {
  emptyServerRoster,
  type ServerRoster,
  type ServerRosterEntry,
} from '../services/server-presence-roster.helpers';

const VALHEIM = 10;
const COD = 20;

function linked(discordUserId: string, name: string): ServerRosterEntry {
  return {
    key: `user:${discordUserId}`,
    steamId: `steam-${discordUserId}`,
    userId: 1,
    discordUserId,
    name,
  };
}

function unlinked(steamId: string, name: string | null): ServerRosterEntry {
  return {
    key: `steam:${steamId}`,
    steamId,
    userId: null,
    discordUserId: null,
    name,
  };
}

function roster(byGame: Record<number, ServerRosterEntry[]>): ServerRoster {
  const r = emptyServerRoster();
  for (const [id, entries] of Object.entries(byGame)) {
    r.byGame.set(Number(id), entries);
    r.gameNames.set(Number(id), Number(id) === VALHEIM ? 'Valheim' : 'CoD');
  }
  return r;
}

const group = (gameId: number | null, memberIds: string[]): LobbyGameGroup => ({
  gameId,
  gameName: gameId === null ? 'Untitled Gaming Session' : `g${gameId}`,
  memberIds,
});

const find = (groups: LobbyGameGroup[], gameId: number | null) =>
  groups.find((g) => g.gameId === gameId);

describe('mergeServerPresence', () => {
  it('AC9: an empty roster returns detection unchanged (no plugin = voice-only)', () => {
    const detected = [group(VALHEIM, ['a']), group(null, ['b'])];
    expect(mergeServerPresence(detected, ['a', 'b'], emptyServerRoster())).toBe(
      detected,
    );
  });

  it('ruling 2: a voice member on the server leaves "no game detected" for the game group with a 🖥 marker', () => {
    const detected = [
      group(VALHEIM, ['lanati']),
      group(null, ['pariah', 'cat']),
    ];
    const merged = mergeServerPresence(
      detected,
      ['lanati', 'pariah', 'cat'],
      roster({ [VALHEIM]: [linked('pariah', 'Pariah')] }),
    );
    expect(find(merged, VALHEIM)).toEqual({
      gameId: VALHEIM,
      gameName: 'g10',
      memberIds: ['lanati', 'pariah'],
      onServerIds: ['pariah'],
    });
    expect(find(merged, null)?.memberIds).toEqual(['cat']);
  });

  it('ruling 2: the null group disappears when its last member is on the server', () => {
    const merged = mergeServerPresence(
      [group(null, ['pariah'])],
      ['pariah'],
      roster({ [VALHEIM]: [linked('pariah', 'Pariah')] }),
    );
    expect(merged.map((g) => g.gameId)).toEqual([VALHEIM]);
    expect(find(merged, VALHEIM)?.gameName).toBe('Valheim');
  });

  it('Q3: server presence beats a conflicting rich-presence game', () => {
    const merged = mergeServerPresence(
      [group(COD, ['pariah', 'x'])],
      ['pariah', 'x'],
      roster({ [VALHEIM]: [linked('pariah', 'Pariah')] }),
    );
    expect(find(merged, COD)?.memberIds).toEqual(['x']);
    expect(find(merged, VALHEIM)?.memberIds).toEqual(['pariah']);
  });

  it('a voice member already detected on the game keeps their place and gains the marker', () => {
    const merged = mergeServerPresence(
      [group(VALHEIM, ['a', 'pariah'])],
      ['a', 'pariah'],
      roster({ [VALHEIM]: [linked('pariah', 'Pariah')] }),
    );
    expect(find(merged, VALHEIM)?.memberIds).toEqual(['a', 'pariah']);
    expect(find(merged, VALHEIM)?.onServerIds).toEqual(['pariah']);
  });

  it('ruling 3: a linked player on the server but not in voice is listed server-only by username', () => {
    const merged = mergeServerPresence(
      [group(VALHEIM, ['lanati'])],
      ['lanati'],
      roster({ [VALHEIM]: [linked('cat', 'ProbablyaCat')] }),
    );
    const g = find(merged, VALHEIM);
    expect(g?.memberIds).toEqual(['lanati']);
    expect(g?.serverOnly?.map((p) => p.name)).toEqual(['ProbablyaCat']);
    expect(g ? groupSize(g) : -1).toBe(2);
  });

  it('Q1: server-only players form a group even with nobody in voice on that game', () => {
    const merged = mergeServerPresence(
      [group(null, ['cat'])],
      ['cat'],
      roster({ [VALHEIM]: [unlinked('s1', 'Bjorn'), unlinked('s2', 'Ragna')] }),
    );
    const g = find(merged, VALHEIM);
    expect(g?.gameName).toBe('Valheim');
    expect(g?.memberIds).toEqual([]);
    expect(g?.serverOnly?.map((p) => p.name)).toEqual(['Bjorn', 'Ragna']);
    expect(find(merged, null)?.memberIds).toEqual(['cat']);
  });

  it('Q4: an unnamed unlinked player is counted and summarised anonymously, never by SteamID', () => {
    const merged = mergeServerPresence(
      [group(VALHEIM, ['a'])],
      ['a'],
      roster({
        [VALHEIM]: [
          unlinked('76561198000000001', null),
          unlinked('76561198000000002', null),
          unlinked('76561198000000003', 'Kveldulf'),
        ],
      }),
    );
    const g = find(merged, VALHEIM);
    if (!g) throw new Error('Valheim group missing');
    expect(groupSize(g)).toBe(4);
    expect(serverOnlySummary(g)).toEqual({
      named: ['Kveldulf'],
      anonymousCount: 2,
    });
    expect(JSON.stringify(serverOnlySummary(g))).not.toContain('7656119');
  });

  it('ruling 4: a person in voice AND on the server is counted once', () => {
    const merged = mergeServerPresence(
      [group(VALHEIM, ['pariah'])],
      ['pariah'],
      roster({ [VALHEIM]: [linked('pariah', 'Pariah')] }),
    );
    const g = find(merged, VALHEIM);
    expect(g?.serverOnly).toBeUndefined();
    expect(g ? groupSize(g) : -1).toBe(1);
  });

  it('ruling 4: one on two servers of different games is consumed by the lowest game id only', () => {
    const merged = mergeServerPresence(
      [group(null, ['pariah'])],
      ['pariah'],
      roster({
        [VALHEIM]: [linked('pariah', 'P')],
        [COD]: [linked('pariah', 'P')],
      }),
    );
    expect(merged.map((g) => [g.gameId, groupSize(g)])).toEqual([[VALHEIM, 1]]);
  });

  it('does not mutate the detected groups', () => {
    const detected = [group(null, ['pariah'])];
    mergeServerPresence(
      detected,
      ['pariah'],
      roster({ [VALHEIM]: [linked('pariah', 'P')] }),
    );
    expect(detected).toEqual([group(null, ['pariah'])]);
  });
});

describe('groupSize / partitionLobbyGroups', () => {
  it('without server data groupSize is memberIds.length', () => {
    expect(groupSize(group(VALHEIM, ['a', 'b']))).toBe(2);
  });

  it('ruling 4: 1 in voice + a different 1 on the server qualifies at minPlayers 2', () => {
    const merged = mergeServerPresence(
      [group(VALHEIM, ['a'])],
      ['a'],
      roster({ [VALHEIM]: [unlinked('s1', 'Bjorn')] }),
    );
    const split = partitionLobbyGroups(merged, false, 2);
    expect(split.qualifying.map((g) => g.gameId)).toEqual([VALHEIM]);
    expect(split.dropped).toEqual([]);
  });

  it('ruling 4: one person alone in voice AND on the server stays below minPlayers 2', () => {
    const merged = mergeServerPresence(
      [group(VALHEIM, ['a'])],
      ['a'],
      roster({ [VALHEIM]: [linked('a', 'A')] }),
    );
    const split = partitionLobbyGroups(merged, false, 2);
    expect(split.qualifying).toEqual([]);
    expect(split.dropped.map((g) => g.gameId)).toEqual([VALHEIM]);
  });
});

describe('serverGameOf', () => {
  it('returns null for a member on no server', () => {
    expect(
      serverGameOf(roster({ [VALHEIM]: [linked('x', 'X')] }), 'y'),
    ).toBeNull();
  });
});
