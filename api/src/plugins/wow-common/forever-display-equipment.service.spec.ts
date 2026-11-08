import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { DisplayEquipmentRow } from '../plugin-host/extension-points';
import { addonSnapshotToEquipment } from './addon-equipment.adapter';
import {
  loadForeverCharSnapshot,
  type ForeverCharSnapshot,
} from './forever-char-snapshot.query';
import {
  armoryHasEquipment,
  ForeverDisplayEquipmentService,
  snapshotItemIds,
} from './forever-display-equipment.service';
import type { WowItemMetaService } from './wowhead-item/wow-item-meta.service';

jest.mock('./forever-char-snapshot.query', () => ({
  loadForeverCharSnapshot: jest.fn(),
}));
const loadMock = loadForeverCharSnapshot as jest.MockedFunction<
  typeof loadForeverCharSnapshot
>;

const CAPTURED = new Date('2026-09-15T12:00:00.000Z');
const armory = (syncedAt: string) => ({
  equippedItemLevel: null,
  items: [],
  syncedAt,
});

/** A snapshot captured at `capturedAt` wearing one item. */
const snap = (capturedAt: Date): ForeverCharSnapshot => ({
  data: {
    gear: [{ slot: 1, itemId: 16921, bonusIds: [] }],
    talents: { nodes: [] },
    lockouts: [],
  },
  capturedAt,
});

/** Stored Armory equipment with one item, synced at `syncedAt`. */
const armoryWithItem = (syncedAt: string) => ({
  ...addonSnapshotToEquipment(snap(CAPTURED), new Map()),
  syncedAt,
});

describe('armoryHasEquipment (ROK-2138 D8)', () => {
  it('is false with no stored equipment', () => {
    expect(armoryHasEquipment(null)).toBe(false);
  });
  it('is false for stored equipment with zero items', () => {
    expect(armoryHasEquipment(armory('2026-09-20T00:00:00Z'))).toBe(false);
  });
  it('is true for stored equipment with at least one item, whatever its age', () => {
    expect(armoryHasEquipment(armoryWithItem('2020-01-01T00:00:00Z'))).toBe(
      true,
    );
  });
});

describe('ForeverDisplayEquipmentService.resolve (ROK-2138 D8)', () => {
  const db = {} as PostgresJsDatabase<typeof schema>;
  const itemMeta = {
    getMeta: jest.fn().mockResolvedValue(new Map()),
    enqueue: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ForeverDisplayEquipmentService(
    db,
    itemMeta as unknown as WowItemMetaService,
  );
  const row = (
    equipment: DisplayEquipmentRow['equipment'],
  ): DisplayEquipmentRow => ({
    id: 'char-1',
    gameVariant: 'wow_forever',
    equipment,
  });

  beforeEach(() => loadMock.mockReset());

  it('AC10: keeps the Armory gear (undefined) even when the snapshot is newer', async () => {
    loadMock.mockResolvedValue(snap(new Date('2026-11-07T00:00:00Z')));
    const armoryGear = armoryWithItem('2026-10-01T00:00:00Z');
    expect(await service.resolve(row(armoryGear))).toBeUndefined();
  });

  it('AC11: the addon gear fills the gap when there is no Armory equipment', async () => {
    loadMock.mockResolvedValue(snap(CAPTURED));
    const dto = await service.resolve(row(null));
    expect(dto?.items).toHaveLength(1);
    expect(dto?.items[0]?.itemId).toBe(16921);
  });

  it('AC11: the addon gear fills the gap when the Armory has zero items', async () => {
    loadMock.mockResolvedValue(snap(CAPTURED));
    const dto = await service.resolve(row(armory('2026-11-07T00:00:00Z')));
    expect(dto?.items).toHaveLength(1);
  });

  it('no snapshot and no Armory gear is undefined', async () => {
    loadMock.mockResolvedValue(null);
    expect(await service.resolve(row(null))).toBeUndefined();
  });
});

describe('snapshotItemIds', () => {
  it('dedupes ids and skips entries without one', () => {
    const data = {
      gear: [
        { slot: 1, itemId: 16921, bonusIds: [] },
        { slot: 4, bonusIds: [] },
        { slot: 11, itemId: 5, bonusIds: [] },
        { slot: 12, itemId: 5, bonusIds: [] },
      ],
      talents: { nodes: [] },
      lockouts: [],
    };
    expect(snapshotItemIds({ data, capturedAt: CAPTURED })).toEqual([16921, 5]);
  });
});
