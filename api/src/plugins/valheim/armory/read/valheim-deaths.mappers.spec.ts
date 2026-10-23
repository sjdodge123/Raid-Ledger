/**
 * ROK-1930 L2 — the Deaths widget fold: D7 grouping/resolution, D9
 * characterId, sort tie-breaks and `since`.
 */
import type {
  DeathGroupRow,
  DeathProfileRow,
} from '../valheim-deaths.repository';
import { MAX_DEATH_PLAYERS, toDeathsResponse } from './valheim-deaths.mappers';

const A = '76561198000000001';
const B = '76561198000000002';
const at = (h: number) => new Date(Date.UTC(2026, 9, 20, h));
const group = (o: Partial<DeathGroupRow>): DeathGroupRow => ({
  steamId: null,
  characterName: 'Ragnar',
  deaths: 1,
  firstDeathAt: at(1),
  lastDeathAt: at(1),
  ...o,
});
const prof = (o: Partial<DeathProfileRow>): DeathProfileRow => ({
  id: 1,
  steamId: A,
  name: 'Ragnar',
  capturedAt: at(0),
  ...o,
});
const rows = (groups: DeathGroupRow[], profiles: DeathProfileRow[] = []) =>
  toDeathsResponse({ groups, profiles }).players.map(
    (p) => `${p.name}|${p.steamId ?? '-'}|${p.deaths}|${p.characterId ?? '-'}`,
  );

describe('toDeathsResponse', () => {
  it('sorts by deaths desc, then lastDeathAt desc, then name asc', () => {
    const out = rows([
      group({ steamId: A, characterName: 'Bo', deaths: 2, lastDeathAt: at(3) }),
      group({ steamId: B, characterName: 'Al', deaths: 2, lastDeathAt: at(3) }),
      group({ characterName: 'Cy', deaths: 2, lastDeathAt: at(5) }),
      group({ characterName: 'Di', deaths: 4 }),
    ]);
    expect(out).toEqual([
      'Di|-|4|-',
      'Cy|-|2|-',
      'Al|' + B + '|2|-',
      'Bo|' + A + '|2|-',
    ]);
  });

  it('merges a NULL-steam bucket into the one same-name profile SteamID (D7)', () => {
    const out = rows(
      [
        group({
          steamId: A,
          characterName: 'Ragnar',
          deaths: 2,
          lastDeathAt: at(2),
        }),
        group({
          steamId: null,
          characterName: 'Ragnar',
          deaths: 1,
          lastDeathAt: at(4),
        }),
      ],
      [prof({ id: 9 })],
    );
    expect(out).toEqual([`Ragnar|${A}|3|9`]);
  });

  it('keeps a NULL-steam bucket name-only when two profiles share the name', () => {
    const out = rows(
      [group({ characterName: 'Twin', deaths: 2 })],
      [
        prof({ id: 1, name: 'Twin', steamId: A }),
        prof({ id: 2, name: 'Twin', steamId: B }),
      ],
    );
    expect(out).toEqual(['Twin|-|2|-']);
  });

  it('names the bar after the newest death and links the newest profile (D9)', () => {
    const out = rows(
      [
        group({ steamId: A, characterName: 'Old', lastDeathAt: at(1) }),
        group({ steamId: A, characterName: 'New', lastDeathAt: at(6) }),
      ],
      [
        prof({ id: 3, name: 'Old', capturedAt: at(1) }),
        prof({ id: 4, name: 'New', capturedAt: at(7) }),
      ],
    );
    expect(out).toEqual([`New|${A}|2|4`]);
  });

  it('reports since = the earliest death, null and [] when there are none', () => {
    const r = toDeathsResponse({
      groups: [
        group({ firstDeathAt: at(5) }),
        group({ characterName: 'X', firstDeathAt: at(2) }),
      ],
      profiles: [],
    });
    expect(r.since).toBe(at(2).toISOString());
    expect(toDeathsResponse({ groups: [], profiles: [] })).toEqual({
      players: [],
      since: null,
    });
  });

  it(`caps the list at ${MAX_DEATH_PLAYERS} bars`, () => {
    const many = Array.from({ length: MAX_DEATH_PLAYERS + 5 }, (_, i) =>
      group({ characterName: `p${i}` }),
    );
    expect(
      toDeathsResponse({ groups: many, profiles: [] }).players,
    ).toHaveLength(MAX_DEATH_PLAYERS);
  });
});
