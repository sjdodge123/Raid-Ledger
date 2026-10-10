/**
 * ROK-1727: unit tests for the pure addon snapshot → equipment adapter.
 */
import {
  CharacterEquipmentSchema,
  type AddonSnapshotGearItem,
} from '@raid-ledger/contract';
import {
  ADDON_SLOT_NAMES,
  addonSnapshotToEquipment,
  type AddonItemMeta,
} from './addon-equipment.adapter';

const CAPTURED_AT = new Date('2026-10-01T12:00:00.000Z');

function gearItem(
  slot: number,
  itemId?: number,
  ilvl?: number,
): AddonSnapshotGearItem {
  return { slot, itemId, ilvl, bonusIds: [] };
}

function snapshot(gear: AddonSnapshotGearItem[]) {
  return { data: { gear }, capturedAt: CAPTURED_AT };
}

function meta(overrides: Partial<AddonItemMeta> = {}): AddonItemMeta {
  return {
    status: 'resolved',
    env: 16,
    name: 'Thunderfury',
    quality: 5,
    icon: 'inv_sword_39',
    ...overrides,
  };
}

describe('addonSnapshotToEquipment', () => {
  it('maps all 19 inventory slots to the grid slot names in slot order', () => {
    const gear = Array.from({ length: 19 }, (_, i) =>
      gearItem(i + 1, 1000 + i, 60),
    );
    const result = addonSnapshotToEquipment(snapshot(gear), new Map());
    expect(result.items.map((i) => i.slot)).toEqual([
      'HEAD',
      'NECK',
      'SHOULDER',
      'SHIRT',
      'CHEST',
      'WAIST',
      'LEGS',
      'FEET',
      'WRIST',
      'HANDS',
      'FINGER_1',
      'FINGER_2',
      'TRINKET_1',
      'TRINKET_2',
      'BACK',
      'MAIN_HAND',
      'OFF_HAND',
      'RANGED',
      'TABARD',
    ]);
    expect(Object.keys(ADDON_SLOT_NAMES)).toHaveLength(19);
  });
});

describe('addonSnapshotToEquipment — resolved items', () => {
  it('builds a resolved item from its meta row', () => {
    const result = addonSnapshotToEquipment(
      snapshot([gearItem(16, 19019, 80)]),
      new Map([[19019, meta()]]),
    );
    expect(result.items).toEqual([
      {
        slot: 'MAIN_HAND',
        itemId: 19019,
        itemLevel: 80,
        itemSubclass: null,
        name: 'Thunderfury',
        quality: 'LEGENDARY',
        iconUrl:
          'https://wow.zamimg.com/images/wow/icons/large/inv_sword_39.jpg',
        wowheadEnv: 16,
        resolved: true,
      },
    ]);
  });

  it('keeps env 4 for a classic_fallback item', () => {
    const result = addonSnapshotToEquipment(
      snapshot([gearItem(1, 16921, 66)]),
      new Map([
        [
          16921,
          meta({
            status: 'classic_fallback',
            env: 4,
            name: 'Halo of Transcendence',
            quality: 4,
          }),
        ],
      ]),
    );
    expect(result.items[0]).toMatchObject({
      name: 'Halo of Transcendence',
      quality: 'EPIC',
      wowheadEnv: 4,
      resolved: true,
    });
  });
});

describe('addonSnapshotToEquipment — unresolved items', () => {
  it.each([
    ['no meta row', undefined],
    [
      'not_found row',
      meta({
        status: 'not_found',
        env: null,
        name: null,
        quality: null,
        icon: null,
      }),
    ],
    [
      'error row',
      meta({
        status: 'error',
        env: null,
        name: null,
        quality: null,
        icon: null,
      }),
    ],
  ])('renders an Item #<id> placeholder for %s', (_label, row) => {
    const metaMap = new Map<number, AddonItemMeta>(row ? [[16921, row]] : []);
    const result = addonSnapshotToEquipment(
      snapshot([gearItem(1, 16921, 66)]),
      metaMap,
    );
    expect(result.items).toEqual([
      {
        slot: 'HEAD',
        itemId: 16921,
        itemLevel: 66,
        itemSubclass: null,
        name: 'Item #16921',
        quality: 'COMMON',
        resolved: false,
      },
    ]);
    expect(result.items[0]).not.toHaveProperty('iconUrl');
    expect(result.items[0]).not.toHaveProperty('wowheadEnv');
  });
});

describe('addonSnapshotToEquipment — item level, gaps and output shape', () => {
  it('averages item level over equipped slots excluding shirt and tabard', () => {
    const result = addonSnapshotToEquipment(
      snapshot([
        gearItem(1, 1, 60),
        gearItem(5, 2, 63),
        gearItem(4, 3, 1),
        gearItem(19, 4, 1),
        gearItem(16, 5), // no ilvl: equipped but not counted
      ]),
      new Map(),
    );
    expect(result.equippedItemLevel).toBe(62); // round((60 + 63) / 2)
    expect(result.items.find((i) => i.slot === 'MAIN_HAND')?.itemLevel).toBe(0);
  });

  it('skips gear entries without an itemId (empty slots)', () => {
    const result = addonSnapshotToEquipment(
      snapshot([gearItem(1), gearItem(2, 7, 50)]),
      new Map(),
    );
    expect(result.items.map((i) => i.slot)).toEqual(['NECK']);
    expect(result.equippedItemLevel).toBe(50);
  });

  it('returns empty equipment with a null average for empty gear', () => {
    const result = addonSnapshotToEquipment(snapshot([]), new Map());
    expect(result).toEqual({
      equippedItemLevel: null,
      items: [],
      syncedAt: '2026-10-01T12:00:00.000Z',
      source: 'addon',
    });
  });

  it('lets the last entry win on a duplicate slot', () => {
    const result = addonSnapshotToEquipment(
      snapshot([gearItem(1, 111, 50), gearItem(1, 222, 70)]),
      new Map(),
    );
    expect(result.items.map((i) => i.itemId)).toEqual([222]);
    expect(result.equippedItemLevel).toBe(70);
  });

  it('tags the output as addon-sourced and validates against the contract', () => {
    const result = addonSnapshotToEquipment(
      snapshot([gearItem(16, 19019, 80), gearItem(1, 16921, 66)]),
      new Map([[19019, meta()]]),
    );
    expect(result.source).toBe('addon');
    expect(result.syncedAt).toBe(CAPTURED_AT.toISOString());
    expect(CharacterEquipmentSchema.parse(result)).toEqual(result);
  });
});
