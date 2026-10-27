/**
 * ROK-2014 — pure container-day helpers: segment grain (D2/D3), base totals
 * (D9), the diff write (D6) and the retention cutoff (D8).
 */
import type {
  ValheimContainer,
  ValheimContainersMessage,
} from '@raid-ledger/contract';
import {
  CONTAINERS_DEMO_MESSAGE,
  containersDemoMessage,
} from './valheim-armory-containers-demo-fixture';
import {
  CONTAINER_DAYS_RETAINED,
  baseSegKey,
  dayBaseTotals,
  dayItemTotals,
  diffDay,
  itemSegKey,
  retentionCutoff,
  sameBaseRow,
  segmentOwner,
  type DayBaseItemTotal,
  type DayItemTotal,
} from './valheim-container-days.helpers';

const OWNER = '1000000000000001';
const item = (prefab: string, vehicle: boolean, owner: string) =>
  dayItemTotals(CONTAINERS_DEMO_MESSAGE).get(
    itemSegKey({ prefab, vehicle, owner }),
  )?.total;

const chest = (over: Partial<ValheimContainer>): ValheimContainer => ({
  prefab: 'piece_chest',
  x: 0,
  y: 30,
  z: 0,
  creatorPlayerId: OWNER,
  privacy: 'public',
  vehicle: false,
  slots: 30,
  usedSlots: 1,
  unreadable: false,
  omittedEntries: 0,
  items: [],
  ...over,
});
const msgOf = (containers: ValheimContainer[]): ValheimContainersMessage => ({
  ...CONTAINERS_DEMO_MESSAGE,
  containers,
});

describe('segmentOwner (D3)', () => {
  it('is empty for shared chests and the builder for private ones', () => {
    expect(segmentOwner({ privacy: 'public', creatorPlayerId: OWNER })).toBe(
      '',
    );
    expect(segmentOwner({ privacy: 'group', creatorPlayerId: OWNER })).toBe('');
    expect(segmentOwner({ privacy: 'private', creatorPlayerId: OWNER })).toBe(
      OWNER,
    );
  });
});

describe('dayItemTotals (D2/D3)', () => {
  it('sums stacks per prefab × vehicle × owner over the demo scan', () => {
    expect(item('Wood', false, '')).toBe(57);
    expect(item('Wood', true, '')).toBe(99);
    expect(item('Coins', false, OWNER)).toBe(999);
    expect(item('Coins', false, '')).toBeUndefined();
    expect(item('BlackMetal', false, '')).toBe(120);
  });

  it('sums qualities into one prefab row', () => {
    const msg = msgOf([
      chest({
        items: [
          { prefab: 'SwordIron', quality: 1, stack: 1 },
          { prefab: 'SwordIron', quality: 3, stack: 2 },
        ],
      }),
    ]);
    expect([...dayItemTotals(msg).values()]).toEqual([
      { prefab: 'SwordIron', vehicle: false, owner: '', total: 3 },
    ]);
  });

  it('stores no row for a chest with no items', () => {
    expect(dayItemTotals(msgOf([chest({ items: [] })])).size).toBe(0);
  });
});

describe('dayBaseTotals (D9)', () => {
  it('puts every demo chest (cart and private attached) in one base', () => {
    const rows = [...dayBaseTotals(CONTAINERS_DEMO_MESSAGE).values()];
    expect(new Set(rows.map((r) => r.baseKey)).size).toBe(1);
    const wood = rows.filter((r) => r.prefab === 'Wood');
    expect(wood.map((r) => [r.vehicle, r.total]).sort()).toEqual([
      [false, 57],
      [true, 99],
    ]);
    expect(rows.find((r) => r.prefab === 'Coins')?.owner).toBe(OWNER);
  });

  it('gives the second base its own rows and centroid', () => {
    const rows = [...dayBaseTotals(containersDemoMessage(true)).values()];
    const stone = rows.filter((r) => r.prefab === 'Stone');
    expect(stone.map((r) => r.total).sort((a, b) => a - b)).toEqual([20, 120]);
    const far = stone.find((r) => r.total === 120);
    expect(far && [far.baseX, far.baseZ]).toEqual([605, -360]);
  });

  it('skips a chest attached to no base', () => {
    const msg = msgOf([
      chest({ items: [{ prefab: 'Wood', quality: 1, stack: 5 }] }),
      chest({
        x: 500,
        vehicle: true,
        items: [{ prefab: 'Stone', quality: 1, stack: 9 }],
      }),
    ]);
    const prefabs = [...dayBaseTotals(msg).values()].map((r) => r.prefab);
    expect(prefabs).toEqual(['Wood']);
  });
});

describe('diffDay (D6)', () => {
  const row = (prefab: string, total: number): DayItemTotal => ({
    prefab,
    vehicle: false,
    owner: '',
    total,
  });
  const desiredOf = (rows: DayItemTotal[]) =>
    new Map(rows.map((r) => [itemSegKey(r), r]));

  it('writes only new or changed rows and deletes absent ones', () => {
    const existing = [
      { ...row('Wood', 10), id: 1 },
      { ...row('Stone', 5), id: 2 },
      { ...row('Resin', 3), id: 3 },
    ];
    const desired = desiredOf([
      row('Wood', 10),
      row('Stone', 7),
      row('Tin', 1),
    ]);
    expect(diffDay(existing, desired, itemSegKey)).toEqual({
      upserts: [row('Stone', 7), row('Tin', 1)],
      deleteIds: [3],
    });
  });

  it('rewrites a base row whose centroid moved even at the same total', () => {
    const base: DayBaseItemTotal = {
      ...row('Wood', 10),
      baseKey: 'k',
      baseX: 1,
      baseZ: 2,
    };
    const moved = { ...base, baseX: 4 };
    const desired = new Map([[baseSegKey(moved), moved]]);
    const diff = diffDay(
      [{ ...base, id: 9 }],
      desired,
      baseSegKey,
      sameBaseRow,
    );
    expect(diff).toEqual({ upserts: [moved], deleteIds: [] });
  });
});

describe('retentionCutoff (D8)', () => {
  it(`is ${CONTAINER_DAYS_RETAINED} calendar days back, across months`, () => {
    expect(retentionCutoff('2026-10-27')).toBe('2026-09-27');
    expect(retentionCutoff('2026-03-01')).toBe('2026-01-30');
  });
});
