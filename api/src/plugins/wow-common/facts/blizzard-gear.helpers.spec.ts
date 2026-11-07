/**
 * ROK-1920 — Armory equipment (string slot types) → gear fact items.
 */
import type { EquipmentItemDto } from '@raid-ledger/contract';
import {
  armoryGear,
  blizzardSlotId,
  toGearItem,
} from './blizzard-gear.helpers';

const SLOT_TYPES: ReadonlyArray<[string, number]> = [
  ['HEAD', 1],
  ['NECK', 2],
  ['SHOULDER', 3],
  ['SHIRT', 4],
  ['CHEST', 5],
  ['WAIST', 6],
  ['LEGS', 7],
  ['FEET', 8],
  ['WRIST', 9],
  ['HANDS', 10],
  ['FINGER_1', 11],
  ['FINGER_2', 12],
  ['TRINKET_1', 13],
  ['TRINKET_2', 14],
  ['BACK', 15],
  ['MAIN_HAND', 16],
  ['OFF_HAND', 17],
  ['RANGED', 18],
  ['TABARD', 19],
];

function item(over: Partial<EquipmentItemDto> = {}): EquipmentItemDto {
  return {
    slot: 'HEAD',
    name: 'Lionheart Helm',
    itemId: 12640,
    quality: 'EPIC',
    itemLevel: 63,
    itemSubclass: null,
    ...over,
  };
}

function equipment(items: EquipmentItemDto[], source?: 'armory' | 'addon') {
  return {
    equippedItemLevel: 63,
    items,
    syncedAt: '2026-11-05T10:00:00.000Z',
    ...(source ? { source } : {}),
  };
}

describe('blizzardSlotId', () => {
  it.each(SLOT_TYPES)('maps %s to inventory slot %i', (type, id) => {
    expect(blizzardSlotId(type)).toBe(id);
  });

  it('returns null for a slot outside the 19 equipment slots', () => {
    expect(blizzardSlotId('RANGED_2')).toBeNull();
  });
});

describe('toGearItem', () => {
  it('maps slot, itemId, ilvl and name with empty bonusIds', () => {
    expect(toGearItem(item())).toEqual({
      slot: 1,
      itemId: 12640,
      ilvl: 63,
      bonusIds: [],
      name: 'Lionheart Helm',
    });
  });

  it('drops an item whose slot type is unknown', () => {
    expect(toGearItem(item({ slot: 'RANGED_2' }))).toBeNull();
  });

  it('takes the first reported enchantment id', () => {
    const got = toGearItem(
      item({
        enchantments: [
          { displayString: 'no id' },
          { displayString: '+8 Strength', enchantmentId: 1885 },
          { displayString: 'later', enchantmentId: 9 },
        ],
      }),
    );
    expect(got?.enchantId).toBe(1885);
  });

  it('omits enchantId when no enchantment reports an id', () => {
    const none = toGearItem(item());
    const idless = toGearItem(
      item({ enchantments: [{ displayString: 'no id' }] }),
    );
    expect(none && 'enchantId' in none).toBe(false);
    expect(idless && 'enchantId' in idless).toBe(false);
  });

  it('omits an empty name and caps a long one at 128 chars', () => {
    const unnamed = toGearItem(item({ name: '' }));
    expect(unnamed && 'name' in unnamed).toBe(false);
    expect(toGearItem(item({ name: 'x'.repeat(200) }))?.name).toHaveLength(128);
  });
});

describe('armoryGear', () => {
  it('maps every mappable item of stored Armory equipment', () => {
    const got = armoryGear(
      equipment([
        item(),
        item({ slot: 'MAIN_HAND', itemId: 19019, itemLevel: 80 }),
        item({ slot: 'RANGED_2', itemId: 1 }),
      ]),
    );
    expect(got?.map((g) => [g.slot, g.itemId, g.ilvl])).toEqual([
      [1, 12640, 63],
      [16, 19019, 80],
    ]);
  });

  it("accepts an explicit source: 'armory'", () => {
    expect(armoryGear(equipment([item()], 'armory'))).toHaveLength(1);
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['a non-object', 'equipment'],
    ['malformed items', { equippedItemLevel: 1, items: 'x', syncedAt: 'y' }],
    ['a LedgerLink import', equipment([item()], 'addon')],
    ['no items', equipment([])],
    ['only unknown slots', equipment([item({ slot: 'RANGED_2' })])],
  ])('returns null for %s', (_label, raw) => {
    expect(armoryGear(raw)).toBeNull();
  });
});
