/**
 * ROK-1801 layer B — roster identity + dedupe (pure half of the service).
 */
import { buildServerRoster } from './server-presence-roster.helpers';

const V = 10;
const player = (
  pelicanServerId: number,
  steamId: string,
  name: string | null,
  gameId = V,
) => ({
  pelicanServerId,
  gameId,
  steamId,
  name,
});
const games = [{ id: V, name: 'Valheim' }];

describe('buildServerRoster', () => {
  it('Q5: a linked player is named by RL username and carries their Discord id', () => {
    const r = buildServerRoster(
      [player(1, 'S1', 'Pariah-char')],
      [{ id: 7, discordId: 'd7', steamId: 'S1', username: 'Pariah' }],
      games,
    );
    expect(r.byGame.get(V)).toEqual([
      {
        key: 'user:7',
        steamId: 'S1',
        userId: 7,
        discordUserId: 'd7',
        name: 'Pariah',
      },
    ]);
    expect(r.gameNames.get(V)).toBe('Valheim');
  });

  it('ruling 3: an unlinked player is named by character name', () => {
    const r = buildServerRoster([player(1, 'S2', 'Kveldulf')], [], games);
    expect(r.byGame.get(V)?.[0]).toMatchObject({
      key: 'steam:S2',
      userId: null,
      discordUserId: null,
      name: 'Kveldulf',
    });
  });

  it('Q4: an unnamed unlinked player keeps name null — never the SteamID', () => {
    const r = buildServerRoster(
      [player(1, '76561198000000009', null)],
      [],
      games,
    );
    expect(r.byGame.get(V)?.[0]?.name).toBeNull();
  });

  it('dedupes one linked person across two servers of the same game', () => {
    const r = buildServerRoster(
      [player(1, 'S1', 'a'), player(2, 'S1', 'b')],
      [{ id: 7, discordId: 'd7', steamId: 'S1', username: 'Pariah' }],
      games,
    );
    expect(r.byGame.get(V)?.map((e) => e.key)).toEqual(['user:7']);
  });

  it('dedupes an unlinked SteamID across servers, preferring a named sighting', () => {
    const r = buildServerRoster(
      [player(1, 'S2', null), player(2, 'S2', 'Kveldulf')],
      [],
      games,
    );
    expect(r.byGame.get(V)?.map((e) => e.name)).toEqual(['Kveldulf']);
  });

  it('drops players on a game with no games row', () => {
    const r = buildServerRoster([player(1, 'S1', 'x', 99)], [], games);
    expect(r.byGame.size).toBe(0);
  });
});
