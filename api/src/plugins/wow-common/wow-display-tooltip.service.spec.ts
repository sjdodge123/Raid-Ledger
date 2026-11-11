import { Test } from '@nestjs/testing';
import type {
  CharacterEquipmentDto,
  EquipmentItemDto,
  ItemTooltip,
} from '@raid-ledger/contract';
import {
  equipmentItemIds,
  WowDisplayTooltipService,
} from './wow-display-tooltip.service';
import { WowItemMetaService } from './wowhead-item/wow-item-meta.service';
import type { WowItemMetaRow } from './wowhead-item/wowhead-item.types';

const TOOLTIP: ItemTooltip = {
  env: 16,
  slotLabel: 'Head',
  subclass: 'Plate',
  binding: 'Binds when picked up',
  unique: false,
  requiredLevel: 60,
  armor: 700,
  weapon: null,
  stats: [{ key: 'STAMINA', name: 'Stamina', value: 20, unit: 'flat' }],
  effects: [],
  setName: null,
  randomEnchant: false,
};

const FUTURE = new Date('2099-01-01T00:00:00Z');

/** A fresh cache row (not due): resolved, current parser version. */
function metaRow(
  itemId: number,
  over: Partial<WowItemMetaRow> = {},
): WowItemMetaRow {
  return {
    itemId,
    status: 'resolved',
    env: 16,
    name: `Item ${itemId}`,
    quality: 4,
    icon: 'inv_helmet_01',
    fetchedAt: new Date('2026-11-01T00:00:00Z'),
    nextRetryAt: FUTURE,
    attempts: 0,
    tooltip: TOOLTIP,
    tooltipVersion: 1,
    ...over,
  };
}

const item = (itemId: number): EquipmentItemDto => ({
  slot: 'HEAD',
  name: `Item ${itemId}`,
  itemId,
  quality: 'EPIC',
  itemLevel: 66,
  itemSubclass: null,
});

const gear = (...ids: number[]): CharacterEquipmentDto => ({
  equippedItemLevel: 66,
  items: ids.map(item),
  syncedAt: '2026-11-01T00:00:00.000Z',
});

const ROW = { id: 'char-1' };
let service: WowDisplayTooltipService;
let getMeta: jest.Mock;
let enqueue: jest.Mock;

beforeEach(async () => {
  getMeta = jest.fn().mockResolvedValue(new Map());
  enqueue = jest.fn().mockResolvedValue(0);
  const module = await Test.createTestingModule({
    providers: [
      WowDisplayTooltipService,
      { provide: WowItemMetaService, useValue: { getMeta, enqueue } },
    ],
  }).compile();
  service = module.get(WowDisplayTooltipService);
});

describe('WowDisplayTooltipService.decorate (ROK-2176)', () => {
  it('attaches the stored tooltip to each item whose row has one', async () => {
    getMeta.mockResolvedValue(
      new Map([
        [1, metaRow(1)],
        [2, metaRow(2, { tooltip: null })],
      ]),
    );
    const out = await service.decorate(ROW, gear(1, 2));
    expect(out.items[0]?.tooltip).toEqual(TOOLTIP);
    expect(out.items[1]).not.toHaveProperty('tooltip');
    expect(getMeta).toHaveBeenCalledTimes(1);
    expect(getMeta).toHaveBeenCalledWith([1, 2]);
  });

  it('returns a copy and never mutates the stored equipment', async () => {
    getMeta.mockResolvedValue(new Map([[1, metaRow(1)]]));
    const stored = gear(1);
    const out = await service.decorate(ROW, stored);
    expect(out).not.toBe(stored);
    expect(stored.items[0]).not.toHaveProperty('tooltip');
  });

  it('returns the equipment undecorated when the cache read fails', async () => {
    getMeta.mockRejectedValue(new Error('db down'));
    const stored = gear(1);
    expect(await service.decorate(ROW, stored)).toBe(stored);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does not enqueue when every row is fresh', async () => {
    getMeta.mockResolvedValue(new Map([[1, metaRow(1)]]));
    await service.decorate(ROW, gear(1));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('enqueues only the due ids (missing or stale parse) in the background', async () => {
    getMeta.mockResolvedValue(
      new Map([
        [1, metaRow(1)],
        [2, metaRow(2, { tooltip: null, tooltipVersion: null })],
      ]),
    );
    await service.decorate(ROW, gear(1, 2, 3));
    expect(enqueue).toHaveBeenCalledWith([2, 3]);
  });

  it('a failing enqueue never fails the read', async () => {
    enqueue.mockRejectedValue(new Error('limiter'));
    const out = await service.decorate(ROW, gear(5));
    expect(out.items).toHaveLength(1);
  });

  it('skips the cache read when there are no items', async () => {
    const empty = gear();
    expect(await service.decorate(ROW, empty)).toBe(empty);
    expect(getMeta).not.toHaveBeenCalled();
  });
});

describe('equipmentItemIds', () => {
  it('dedupes item ids', () => {
    expect(equipmentItemIds(gear(1, 1, 2))).toEqual([1, 2]);
  });

  it('is empty for malformed stored items', () => {
    const malformed = JSON.parse(
      '{"equippedItemLevel":null,"items":null,"syncedAt":"2026-11-01T00:00:00.000Z"}',
    ) as CharacterEquipmentDto;
    expect(equipmentItemIds(malformed)).toEqual([]);
  });
});
