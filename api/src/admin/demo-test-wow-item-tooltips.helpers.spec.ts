/**
 * ROK-2176 — `seed-item-tooltips` body schema and the pure row builders.
 */
import type { ItemTooltip } from '@raid-ledger/contract';
import { RESOLVED_TTL_MS } from '../plugins/wow-common/wowhead-item/wow-item-meta.resolve';
import { WOWHEAD_TOOLTIP_PARSE_VERSION } from '../plugins/wow-common/wowhead-item/wowhead-item.types';
import {
  SeedItemTooltipsSchema,
  seedArmoryEquipment,
  seedMetaRow,
} from './demo-test-wow-item-tooltips.helpers';

const NOW = new Date('2026-11-11T12:00:00.000Z');

const TOOLTIP = (env: 16 | 4): ItemTooltip => ({
  env,
  slotLabel: 'Legs',
  subclass: 'Plate',
  binding: 'Binds when picked up',
  unique: false,
  requiredLevel: 60,
  armor: 700,
  weapon: null,
  stats: [{ key: 'STAMINA', name: 'Stamina', value: 20 }],
  effects: [],
  setName: null,
  randomEnchant: false,
});

const GEAR = [
  {
    slot: 'FINGER_1',
    itemId: 18821,
    name: 'Ring',
    quality: 'EPIC',
    itemLevel: 67,
  },
  {
    slot: 'MAIN_HAND',
    itemId: 17182,
    name: 'Mace',
    quality: 'LEGENDARY',
    itemLevel: 80,
  },
];

describe('SeedItemTooltipsSchema', () => {
  it('accepts items alone, gear alone, and both', () => {
    const items = [
      { itemId: 1, tooltip: TOOLTIP(16) },
      { itemId: 2, tooltip: null },
    ];
    const characterId = '7d3c8f8e-3d55-4b0b-9a1d-2a8f0b4c6e11';
    expect(SeedItemTooltipsSchema.safeParse({ items }).success).toBe(true);
    expect(
      SeedItemTooltipsSchema.safeParse({ characterId, equipment: GEAR })
        .success,
    ).toBe(true);
    expect(
      SeedItemTooltipsSchema.safeParse({ items, characterId, equipment: GEAR })
        .success,
    ).toBe(true);
  });

  it.each([
    ['an empty body', {}],
    ['gear without a character', { equipment: GEAR }],
    [
      'a character without gear',
      { characterId: '7d3c8f8e-3d55-4b0b-9a1d-2a8f0b4c6e11' },
    ],
    ['a missing tooltip key', { items: [{ itemId: 1 }] }],
    ['an off-shape tooltip', { items: [{ itemId: 1, tooltip: { env: 99 } }] }],
    ['an unknown key', { items: [{ itemId: 1, tooltip: null }], extra: 1 }],
    [
      'a lower-case slot',
      {
        characterId: '7d3c8f8e-3d55-4b0b-9a1d-2a8f0b4c6e11',
        equipment: [{ ...GEAR[0], slot: 'legs' }],
      },
    ],
  ])('rejects %s', (_label, body) => {
    expect(SeedItemTooltipsSchema.safeParse(body).success).toBe(false);
  });
});

describe('seedMetaRow', () => {
  it('writes a fresh found row stamped with the current parser version', () => {
    expect(
      seedMetaRow(
        { itemId: 5, name: 'Legs', quality: 4, tooltip: TOOLTIP(16) },
        NOW,
      ),
    ).toEqual({
      itemId: 5,
      status: 'resolved',
      env: 16,
      name: 'Legs',
      quality: 4,
      icon: null,
      fetchedAt: NOW,
      nextRetryAt: new Date(NOW.getTime() + RESOLVED_TTL_MS),
      attempts: 0,
      tooltip: TOOLTIP(16),
      tooltipVersion: WOWHEAD_TOOLTIP_PARSE_VERSION,
    });
  });

  it('an env 4 tooltip is a classic_fallback row; no tooltip is resolved env 16', () => {
    expect(seedMetaRow({ itemId: 5, tooltip: TOOLTIP(4) }, NOW)).toMatchObject({
      status: 'classic_fallback',
      env: 4,
    });
    expect(seedMetaRow({ itemId: 6, tooltip: null }, NOW)).toMatchObject({
      status: 'resolved',
      env: 16,
      tooltip: null,
      tooltipVersion: WOWHEAD_TOOLTIP_PARSE_VERSION,
    });
  });
});

describe('seedArmoryEquipment', () => {
  it('builds Armory-shaped gear with no source and no tooltip keys', () => {
    const gear = seedArmoryEquipment(GEAR, NOW);
    expect(gear).toEqual({
      equippedItemLevel: 74,
      syncedAt: NOW.toISOString(),
      items: [
        {
          slot: 'FINGER_1',
          itemId: 18821,
          name: 'Ring',
          quality: 'EPIC',
          itemLevel: 67,
          itemSubclass: null,
        },
        {
          slot: 'MAIN_HAND',
          itemId: 17182,
          name: 'Mace',
          quality: 'LEGENDARY',
          itemLevel: 80,
          itemSubclass: null,
        },
      ],
    });
  });
});
