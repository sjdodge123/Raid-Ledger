import {
  assignBases,
  attachToBase,
  baseGrid,
  clusterBases,
  indexChests,
  type BasePoint,
  type ChestIndexRow,
} from './valheim-base-clusters.helpers';
import {
  personalByBase,
  sumByBase,
  toBaseSummaries,
  type ChestStackSum,
} from './valheim-base-totals.helpers';

/** 22-char opaque keys; `k(1) < k(2)` in code-unit order. */
const k = (n: number): string => `K${String(n).padStart(21, '0')}`;
const chest = (
  n: number,
  x: number,
  z: number,
  o: Partial<BasePoint> = {},
) => ({
  key: k(n),
  x,
  z,
  vehicle: false,
  shared: true,
  ...o,
});
const cart = (n: number, x: number, z: number) =>
  chest(n, x, z, { vehicle: true });
const mine = (n: number, x: number, z: number) =>
  chest(n, x, z, { shared: false });
const keysOf = (pts: BasePoint[]) =>
  clusterBases(pts).map((b) => b.members.map((m) => m.key));

describe('clusterBases (ROK-1859)', () => {
  it('links chests up to 64 m apart on the x/z plane, not beyond', () => {
    expect(keysOf([chest(1, 0, 0), chest(2, 63.9, 0)])).toEqual([[k(1), k(2)]]);
    expect(keysOf([chest(1, 0, 0), chest(2, 0, 64)])).toEqual([[k(1), k(2)]]);
    expect(keysOf([chest(1, 0, 0), chest(2, 64.1, 0)])).toEqual([
      [k(1)],
      [k(2)],
    ]);
    // diagonal: 45.3² + 45.3² ≈ 64.06² → apart
    expect(keysOf([chest(1, 0, 0), chest(2, 45.3, 45.3)])).toHaveLength(2);
  });

  it('is single-link: a chain of chests 60 m apart is one base', () => {
    const chain = [0, 60, 120, 180].map((x, i) => chest(i + 1, x, -10));
    const bases = clusterBases(chain);
    expect(bases).toHaveLength(1);
    expect(bases[0]?.members).toHaveLength(4);
  });

  it('links across grid-cell and sign boundaries', () => {
    expect(keysOf([chest(1, -1, -1), chest(2, 62, -1)])).toEqual([
      [k(1), k(2)],
    ]);
    expect(keysOf([chest(1, -32, 5), chest(2, 31, 5)])).toEqual([[k(1), k(2)]]);
  });

  it('keys a base by its smallest chest key, wherever that chest sits', () => {
    const bases = clusterBases([
      chest(9, 0, 0),
      chest(3, 50, 0),
      chest(5, 100, 0),
    ]);
    expect(bases.map((b) => b.key)).toEqual([k(3)]);
  });

  it('sorts bases by chest count desc, then key asc', () => {
    const pts = [
      chest(7, 1000, 0),
      chest(2, 2000, 0),
      chest(8, 0, 0),
      chest(9, 10, 0),
    ];
    expect(clusterBases(pts).map((b) => b.key)).toEqual([k(8), k(2), k(7)]);
  });

  it('is deterministic under any input order', () => {
    const pts = [
      chest(4, 0, 0),
      chest(1, 60, 0),
      chest(6, 120, 30),
      chest(2, 900, 900),
      chest(5, 950, 900),
      chest(3, -500, 20),
      cart(7, 30, 0),
    ];
    const want = JSON.stringify(clusterBases(pts));
    for (const order of [
      [6, 5, 4, 3, 2, 1, 0],
      [3, 0, 6, 1, 5, 2, 4],
    ]) {
      const list = order
        .map((i) => pts[i])
        .filter((p): p is BasePoint => p !== undefined);
      expect(list).toHaveLength(pts.length);
      expect(JSON.stringify(clusterBases(list))).toBe(want);
    }
  });

  it('rounds the centroid of the stationary members (no -0)', () => {
    const [a] = clusterBases([
      chest(1, 0, -1),
      chest(2, 1, -2),
      cart(3, 60, 60),
    ]);
    expect([a?.x, a?.z]).toEqual([1, -1]);
    const [b] = clusterBases([chest(1, -0.4, 0.2)]);
    expect(Object.is(b?.x, 0)).toBe(true);
    expect(b?.z).toBe(0);
  });

  it('never lets a cart/ship bridge two bases or form one', () => {
    const pts = [
      chest(1, 0, 0),
      cart(2, 60, 0),
      chest(3, 120, 0),
      cart(4, 5000, 0),
    ];
    expect(keysOf(pts)).toEqual([[k(1)], [k(3)]]);
  });

  it('never lets a personal chest bridge two bases or form one', () => {
    const pts = [
      chest(1, 0, 0),
      mine(2, 60, 0),
      chest(3, 120, 0),
      mine(4, 5000, 0),
    ];
    expect(keysOf(pts)).toEqual([[k(1)], [k(3)]]);
  });
});

describe('attachToBase / assignBases (ROK-1859)', () => {
  const bases = clusterBases([chest(1, 0, 0), chest(3, 120, 0)]);

  it('attaches a cart between two bases to the nearer one', () => {
    expect(attachToBase({ x: 55, z: 0 }, baseGrid(bases))).toBe(k(1));
    expect(attachToBase({ x: 65, z: 0 }, baseGrid(bases))).toBe(k(3));
  });

  it('breaks an exact tie toward the smaller base key', () => {
    expect(attachToBase({ x: 60, z: 0 }, baseGrid(bases))).toBe(k(1));
    const flipped = clusterBases([chest(5, 0, 0), chest(2, 120, 0)]);
    expect(attachToBase({ x: 60, z: 0 }, baseGrid(flipped))).toBe(k(2));
  });

  it('returns null beyond 64 m of every member', () => {
    expect(attachToBase({ x: 60, z: 64 }, baseGrid(bases))).toBeNull();
    expect(attachToBase({ x: -64.1, z: 0 }, baseGrid(bases))).toBeNull();
    expect(attachToBase({ x: -64, z: 0 }, baseGrid(bases))).toBe(k(1));
  });

  it('maps members to their base and attaches carts/personal chests; carts never chain', () => {
    const pts = [
      chest(1, 0, 0),
      cart(5, 50, 0),
      cart(6, 100, 0),
      mine(7, -40, 0),
    ];
    const assign = assignBases(pts, clusterBases(pts));
    expect(Object.fromEntries(assign)).toEqual({
      [k(1)]: k(1),
      [k(5)]: k(1),
      [k(6)]: null,
      [k(7)]: k(1),
    });
  });
});

describe('indexChests (ROK-1859)', () => {
  const row = (n: number, o: Partial<ChestIndexRow>): ChestIndexRow => ({
    key: k(n),
    prefab: 'piece_chest_wood',
    x: 0,
    y: 0,
    z: 0,
    shared: true,
    base: k(1),
    ...o,
  });

  it('numbers per prefab within a base, ordered x, z, y, key', () => {
    const rows = [
      row(4, { x: 5 }),
      row(3, { x: 1, z: 9 }),
      row(2, { x: 1, z: 2, y: 30 }),
      row(9, { x: 1, z: 2, y: 10 }),
      row(8, { x: 1, z: 2, y: 10 }),
      row(5, { prefab: 'piece_chest', x: 99 }),
    ];
    expect(Object.fromEntries(indexChests(rows))).toEqual({
      [k(8)]: 1,
      [k(9)]: 2,
      [k(2)]: 3,
      [k(3)]: 4,
      [k(4)]: 5,
      [k(5)]: 1,
    });
  });

  it('restarts per base, including the away-from-bases (null) group', () => {
    const rows = [
      row(1, {}),
      row(2, { base: k(7), x: -5 }),
      row(3, { base: null }),
    ];
    expect(Object.fromEntries(indexChests(rows))).toEqual({
      [k(1)]: 1,
      [k(2)]: 1,
      [k(3)]: 1,
    });
  });

  it('numbers personal chests in their own sequence, never interleaving shared', () => {
    const rows = [
      row(1, { x: 0 }),
      row(2, { x: 10, shared: false }),
      row(3, { x: 20 }),
      row(4, { x: 30, shared: false }),
    ];
    expect(Object.fromEntries(indexChests(rows))).toEqual({
      [k(1)]: 1,
      [k(3)]: 2,
      [k(2)]: 1,
      [k(4)]: 2,
    });
  });
});

describe('per-base totals (ROK-1859)', () => {
  const sum = (
    n: number,
    prefab: string,
    total: number,
    quality = 1,
  ): ChestStackSum => ({
    key: k(n),
    prefab,
    quality,
    total,
  });
  const shared = [
    chest(1, 0, 0),
    chest(2, 30, 0),
    chest(3, 700, 0),
    cart(4, 20, 0),
  ];
  const sums = [
    sum(1, 'Wood', 10),
    sum(2, 'Wood', 5),
    sum(2, 'Stone', 7),
    sum(3, 'Resin', 4),
    sum(4, 'Wood', 100),
    sum(9, 'Wood', 1000),
  ];
  const bases = clusterBases(shared);

  it('sums stacks per base with chest counts, ignoring chests outside the set', () => {
    const stationary = shared.filter((p) => !p.vehicle);
    expect(toBaseSummaries(bases, stationary, sums)).toEqual([
      {
        key: k(1),
        x: 15,
        z: 0,
        chestCount: 2,
        vehicleCount: 0,
        totals: [
          { prefab: 'Stone', quality: 1, total: 7, chests: 1 },
          { prefab: 'Wood', quality: 1, total: 15, chests: 2 },
        ],
      },
      {
        key: k(3),
        x: 700,
        z: 0,
        chestCount: 1,
        vehicleCount: 0,
        totals: [{ prefab: 'Resin', quality: 1, total: 4, chests: 1 }],
      },
    ]);
  });

  it('adds attached vehicles to totals and vehicleCount when included', () => {
    const [home] = toBaseSummaries(bases, shared, sums);
    expect(home?.vehicleCount).toBe(1);
    expect(home?.chestCount).toBe(2);
    expect(home?.totals).toContainEqual({
      prefab: 'Wood',
      quality: 1,
      total: 115,
      chests: 3,
    });
  });

  it('keeps qualities apart and groups the unbased under null', () => {
    const assign = new Map<string, string | null>([
      [k(1), k(1)],
      [k(5), null],
    ]);
    const out = sumByBase(assign, [
      sum(1, 'Wood', 1),
      sum(1, 'Wood', 2, 2),
      sum(5, 'Wood', 3),
    ]);
    expect(out.get(k(1))?.totals.map((t) => t.quality)).toEqual([1, 2]);
    expect(out.get(null)).toEqual({
      chestCount: 1,
      totals: [{ prefab: 'Wood', quality: 1, total: 3, chests: 1 }],
    });
  });

  it('splits personal chests by base in base order, away-from-bases last', () => {
    const personal = [mine(6, 5000, 0), mine(7, 690, 0), mine(8, 10, 0)];
    const ps = [sum(6, 'Wood', 1), sum(7, 'Wood', 2), sum(8, 'Wood', 3)];
    expect(
      personalByBase(bases, personal, ps).map((r) => [r.base, r.chestCount]),
    ).toEqual([
      [k(1), 1],
      [k(3), 1],
      [null, 1],
    ]);
  });
});
