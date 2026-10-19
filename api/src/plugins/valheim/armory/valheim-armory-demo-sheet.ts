/**
 * ROK-1836 D8 — DEMO_MODE armory fixture characters (anonymised, from the
 * `packages/contract/valheim-link/v1/fixtures/character-vanilla` shape;
 * inlined because the runtime image does not ship the contract fixtures).
 * Three keyed identities (`c1`…`c3`) share one hub server so a fleet plan
 * can seed C1/C2/C3; `extraRows` adds EAQS rows holding a modded prefab.
 * A fourth identity, `map`, belongs to the ROK-1837 map fixture only (not
 * exposed by the armory route), so neither fixture resets the other's
 * character or nulls the map's `profile_id`.
 */
import type { NewValheimProfile } from '../../../drizzle/schema';

export const ARMORY_FIXTURE_KEYS = ['c1', 'c2', 'c3'] as const;
/** The ROK-1837 map fixture's own character key. */
export const ARMORY_MAP_FIXTURE_KEY = 'map';
export type ArmoryFixtureKey =
  (typeof ARMORY_FIXTURE_KEYS)[number] | typeof ARMORY_MAP_FIXTURE_KEY;

/** The modded prefab the EAQS rows hold (catalogued with a file icon). */
export const ARMORY_FIXTURE_MOD_PREFAB = 'RtD_MythicBlade';

export interface ArmoryFixtureIdentity {
  name: string;
  steamId: string;
  playerId: string;
}

/** Distinct `(steam id, player id)` per key → its own profile row. */
export const ARMORY_FIXTURE_IDENTITIES: Record<
  ArmoryFixtureKey,
  ArmoryFixtureIdentity
> = {
  c1: {
    name: 'Testviking',
    steamId: '76561198000000001',
    playerId: '1000000000000001',
  },
  c2: {
    name: 'Shieldmaiden',
    steamId: '76561198000000002',
    playerId: '1000000000000002',
  },
  c3: {
    name: 'Modviking',
    steamId: '76561198000000003',
    playerId: '1000000000000003',
  },
  map: {
    name: 'Mapmaker',
    steamId: '76561198000000009',
    playerId: '1000000000000009',
  },
};

type Sheet = Pick<
  NewValheimProfile,
  'equipment' | 'inventory' | 'skills' | 'trophies'
>;
type Slot = Sheet['inventory']['items'][number];

const weapon = (prefab: string, quality: number, dur: number, max: number) => ({
  prefab,
  stack: 1,
  quality,
  variant: 0,
  durability: dur,
  maxDurability: max,
});
const stack = (prefab: string, n: number) => ({
  prefab,
  stack: n,
  quality: 1,
  variant: 0,
  durability: null,
  maxDurability: null,
});

/** EAQS: an equipment row (modded blade) + a quick-slot row (meads). */
function eaqsRows(): { height: number; rows: Slot[] } {
  return {
    height: 6,
    rows: [
      {
        x: 0,
        y: 4,
        equipped: false,
        item: weapon(ARMORY_FIXTURE_MOD_PREFAB, 1, 500, 500),
      },
      { x: 0, y: 5, equipped: false, item: stack('MeadHealthMinor', 5) },
    ],
  };
}

function grid(extraRows: boolean, height: number): Sheet['inventory']['grid'] {
  const rows = [
    { y: 4, purpose: 'equipment' as const },
    { y: 5, purpose: 'quickslot' as const },
  ];
  return { width: 8, height, extraRows: extraRows ? rows : [] };
}

/** The sheet columns of a fixture profile (`extraRows` → 8×6 EAQS grid). */
export function fixtureSheet(extraRows: boolean): Sheet {
  const sword = weapon('SwordIron', 3, 180.5, 250);
  const helmet = weapon('HelmetBronze', 2, 300, 400);
  const eaqs = extraRows ? eaqsRows() : { height: 4, rows: [] };
  return {
    equipment: [
      { slot: 'rightHand', item: sword },
      { slot: 'head', item: helmet },
    ],
    inventory: {
      grid: grid(extraRows, eaqs.height),
      items: [
        { x: 0, y: 0, equipped: true, item: sword },
        { x: 1, y: 0, equipped: true, item: helmet },
        { x: 2, y: 0, equipped: false, item: stack('Wood', 50) },
        { x: 7, y: 3, equipped: false, item: stack('CookedMeat', 12) },
        ...eaqs.rows,
      ],
    },
    skills: [
      { id: 'Swords', level: 34.25, accumulator: 12.5 },
      { id: 'Run', level: 41, accumulator: 0 },
      { id: '-1287461328', level: 3.5, accumulator: 1.75 },
    ],
    trophies: ['TrophyBoar', 'TrophyEikthyr'],
  };
}
