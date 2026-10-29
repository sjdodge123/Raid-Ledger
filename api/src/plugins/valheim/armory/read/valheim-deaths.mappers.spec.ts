/**
 * ROK-1930 L2 — the Deaths widget fold: D7 grouping/resolution, D9
 * characterId, sort tie-breaks and `since`.
 */
import type {
  DeathGroupRow,
  DeathProfileRow,
} from '../valheim-deaths.repository';
import {
  MAX_DEATH_PLAYERS,
  UNKNOWN_CHARACTER,
  bucketsForBarKey,
  toDeathsResponse,
} from './valheim-deaths.mappers';

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
    (p) => `${p.name}|${p.key}|${p.deaths}|${p.characterId ?? '-'}`,
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
      'Di|nDi|4|-',
      'Cy|nCy|2|-',
      'Al|nAl|2|-',
      'Bo|nBo|2|-',
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
    expect(out).toEqual(['Ragnar|c9|3|9']);
  });

  it('keeps a NULL-steam bucket name-only when two profiles share the name', () => {
    const out = rows(
      [group({ characterName: 'Twin', deaths: 2 })],
      [
        prof({ id: 1, name: 'Twin', steamId: A }),
        prof({ id: 2, name: 'Twin', steamId: B }),
      ],
    );
    expect(out).toEqual(['Twin|nTwin|2|-']);
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
    expect(out).toEqual(['New|c4|2|4']);
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

  it('never emits a SteamID; suffixes a shared unlinked name by first death (D13)', () => {
    const r = toDeathsResponse({
      groups: [
        group({
          steamId: B,
          characterName: 'Sam',
          firstDeathAt: at(4),
          lastDeathAt: at(4),
        }),
        group({
          steamId: null,
          characterName: 'Sam',
          firstDeathAt: at(2),
          lastDeathAt: at(2),
        }),
        group({
          steamId: A,
          characterName: 'Sam',
          deaths: 3,
          firstDeathAt: at(1),
          lastDeathAt: at(1),
        }),
      ],
      profiles: [],
    });
    expect(r.players.map((p) => `${p.key}|${p.deaths}`)).toEqual([
      'nSam|3',
      'nSam~3|1',
      'nSam~2|1',
    ]);
    expect(JSON.stringify(r)).not.toMatch(/steamId|7656119800000000/);
  });

  it('keeps keys unique when a real name looks like a suffixed key (Sam, Sam, Sam~2)', () => {
    const groups = [
      group({ steamId: A, characterName: 'Sam', firstDeathAt: at(1) }),
      group({ steamId: null, characterName: 'Sam', firstDeathAt: at(2) }),
      group({ steamId: B, characterName: 'Sam~2', firstDeathAt: at(3) }),
    ];
    const keyByName = (gs: DeathGroupRow[]) =>
      toDeathsResponse({ groups: gs, profiles: [] })
        .players.map((p) => `${p.name}@${p.key}`)
        .sort();
    const keys = keyByName(groups);
    expect(keys).toEqual(['Sam@nSam', 'Sam@nSam~2', 'Sam~2@nSam~2~2']);
    expect(keyByName([...groups].reverse())).toEqual(keys);
    expect(
      keyByName([groups[1], groups[2], groups[0]].flatMap((g) => g ?? [])),
    ).toEqual(keys);
  });

  it(`caps the list at ${MAX_DEATH_PLAYERS} bars`, () => {
    const many = Array.from({ length: MAX_DEATH_PLAYERS + 5 }, (_, i) =>
      group({ characterName: `p${i}` }),
    );
    expect(
      toDeathsResponse({ groups: many, profiles: [] }).players,
    ).toHaveLength(MAX_DEATH_PLAYERS);
  });

  it('names a blank-name bucket "Unknown character" instead of failing the contract', () => {
    expect(rows([group({ characterName: '  ', deaths: 2 })])).toEqual([
      `${UNKNOWN_CHARACTER}|n${UNKNOWN_CHARACTER}|2|-`,
    ]);
  });
});

describe('bucketsForBarKey (ROK-2027 D1)', () => {
  const buckets = (
    groups: DeathGroupRow[],
    profiles: DeathProfileRow[],
    key: string,
  ) =>
    bucketsForBarKey({ groups, profiles }, key)
      .map((b) => `${b.steamId ?? '-'}|${b.characterName}`)
      .sort();

  it('returns every bucket a SteamID bar merges, including a rename', () => {
    const groups = [
      group({ steamId: A, characterName: 'Ragnar' }),
      group({ steamId: A, characterName: 'Ragnar2', lastDeathAt: at(3) }),
      group({ steamId: B, characterName: 'Bjorn' }),
    ];
    const profiles = [prof({ id: 42, steamId: A })];
    expect(buckets(groups, profiles, 'c42')).toEqual([
      `${A}|Ragnar`,
      `${A}|Ragnar2`,
    ]);
  });

  it('folds a NULL-steam bucket attributed by the single same-name profile', () => {
    const groups = [
      group({ steamId: A, characterName: 'Ragnar' }),
      group({ steamId: null, characterName: 'Ragnar' }),
    ];
    const profiles = [prof({ id: 7, steamId: A, name: 'Ragnar' })];
    expect(buckets(groups, profiles, 'c7')).toEqual([
      '-|Ragnar',
      `${A}|Ragnar`,
    ]);
  });

  it('resolves a name-only key and its ~2 collision to different buckets', () => {
    const groups = [
      group({ steamId: A, characterName: 'Sam', firstDeathAt: at(1) }),
      group({ steamId: null, characterName: 'Sam', firstDeathAt: at(2) }),
    ];
    expect(buckets(groups, [], 'nSam')).toEqual([`${A}|Sam`]);
    expect(buckets(groups, [], 'nSam~2')).toEqual(['-|Sam']);
  });

  it('returns [] for a key no bar carries', () => {
    const groups = [group({ steamId: A, characterName: 'Ragnar' })];
    expect(buckets(groups, [], 'nNobody')).toEqual([]);
    expect(buckets(groups, [], 'c999')).toEqual([]);
  });
});
