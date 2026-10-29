import {
  MAX_GEAR_BELOW,
  MAX_GEAR_MISSING,
  WowRosterGearSchema,
  type AddonSnapshotGearItem,
} from '@raid-ledger/contract';
import { createDrizzleMock } from '../../../../common/testing/drizzle-mock';
import { AddonSnapshotFactSource } from '../../facts/addon-snapshot.fact-source';
import { resolveFacts } from '../../facts/fact-precedence';
import type { ResolvedWowFacts } from '../../facts/wow-fact.types';
import { computeGear, missingEnchantSlots } from './roster-insights.gear';
import type { InsightRow } from './roster-insights.types';

const EMPTY: ResolvedWowFacts = {
  level: null,
  class: null,
  race: null,
  role: null,
  ilvl: null,
  gear: null,
  professions: null,
  quests: null,
  lockouts: null,
  lastOnline: null,
  enchantsReported: null,
};

const T1 = new Date('2026-10-01T00:00:00.000Z');
const T2 = new Date('2026-10-05T00:00:00.000Z');

let seq = 0;
const uuid = (): string =>
  `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function item(slot: number, enchantId?: number): AddonSnapshotGearItem {
  return {
    slot,
    itemId: 1000 + slot,
    ilvl: 60,
    bonusIds: [],
    ...(enchantId === undefined ? {} : { enchantId }),
  };
}

interface RowOpts {
  level?: number | null;
  ilvl?: number | null;
  gear?: AddonSnapshotGearItem[] | null;
  reported?: boolean | null;
  isMain?: boolean;
  linked?: boolean;
  asOf?: Date | null;
}

function fact<T>(value: T, asOf: Date | null) {
  return { value, source: 'addon' as const, asOf };
}

function row(name: string, o: RowOpts = {}): InsightRow {
  const asOf = o.asOf === undefined ? T2 : o.asOf;
  const level = o.level === undefined ? 60 : o.level;
  const linked = o.linked ?? true;
  return {
    name,
    characterId: linked ? uuid() : null,
    userId: linked ? 1 : null,
    isMain: o.isMain ?? true,
    rankIndex: 0,
    onlineAtExport: null,
    lastOnlineDays: null,
    facts: {
      ...EMPTY,
      level: level === null ? null : fact(level, asOf),
      ilvl: o.ilvl == null ? null : fact(o.ilvl, asOf),
      gear: o.gear == null ? null : fact(o.gear, asOf),
      enchantsReported: o.reported == null ? null : fact(o.reported, asOf),
    },
  };
}

function must<T>(v: T | undefined, label: string): T {
  if (v === undefined) throw new Error(`missing ${label}`);
  return v;
}

const counts = (rows: InsightRow[]): number[] =>
  computeGear(rows).ilvl.buckets.map((b) => b.count);

describe('computeGear — ilvl (AC2)', () => {
  it('has six fixed buckets, and every edge lands in the right one', () => {
    const ilvls = [0, 44, 45, 49, 50, 54, 55, 59, 60, 64, 65, 1200];
    const out = computeGear(ilvls.map((i) => row(`c${i}`, { ilvl: i })));
    expect(out.ilvl.buckets.map(({ from, to }) => [from, to])).toEqual([
      [0, 44],
      [45, 49],
      [50, 54],
      [55, 59],
      [60, 64],
      [65, 999],
    ]);
    expect(out.ilvl.buckets.map((b) => b.count)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(WowRosterGearSchema.safeParse(out).success).toBe(true);
  });

  it('ilvl == floor (55) is NOT below; 54 is', () => {
    const out = computeGear([
      row('AtFloor', { ilvl: 55 }),
      row('Under', { ilvl: 54 }),
    ]);
    expect(out.ilvl.floor).toBe(55);
    expect(out.ilvl.below.map((b) => b.name)).toEqual(['Under']);
    expect(out.ilvl.belowCount).toBe(1);
  });

  it('compares the RAW average to the floor: 54.5 is below 55 and in the 50-54 bucket', () => {
    const out = computeGear([
      row('Half', { ilvl: 54.5 }),
      row('AtFloor', { ilvl: 55 }),
    ]);
    expect(out.ilvl.below.map((b) => b.name)).toEqual(['Half']);
    expect(out.ilvl.belowCount).toBe(1);
    expect(out.ilvl.buckets.map((b) => b.count)).toEqual([0, 0, 1, 1, 0, 0]);
  });

  it('median rounds; null with no reporters', () => {
    expect(
      computeGear([row('A', { ilvl: 50 }), row('B', { ilvl: 55 })]).ilvl.median,
    ).toBe(53);
    expect(computeGear([row('A', { ilvl: 50 })]).ilvl.median).toBe(50);
    expect(computeGear([row('A')]).ilvl.median).toBeNull();
  });

  it('excludes unlinked and non-main rows; below-cap mains count as levelling', () => {
    const out = computeGear([
      row('Cap', { ilvl: 50 }),
      row('Alt', { ilvl: 40, isMain: false }),
      row('Unlinked', { ilvl: 40, linked: false }),
      row('Low', { level: 59, ilvl: 40 }),
      row('UnlinkedLow', { level: 30, linked: false }),
      row('NoLevel', { level: null, ilvl: 40 }),
    ]);
    expect(out.ilvl.reporters).toBe(1);
    expect(out.ilvl.levelling).toBe(1);
    expect(out.ilvl.below.map((b) => b.name)).toEqual(['Cap']);
    expect(counts([row('Alt', { ilvl: 40, isMain: false })])).toEqual([
      0, 0, 0, 0, 0, 0,
    ]);
  });

  it('below is lowest first, capped at 10 with the full total', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row(`m${i}`, { ilvl: 50 - i }),
    );
    const out = computeGear(rows);
    expect(out.ilvl.belowCount).toBe(12);
    expect(out.ilvl.below).toHaveLength(MAX_GEAR_BELOW);
    expect(must(out.ilvl.below[0], 'first below').ilvl).toBe(39);
    expect(must(out.ilvl.below[9], 'last below').ilvl).toBe(48);
  });
});

describe('computeGear — enchants (AC3)', () => {
  it('lists equipped enchantable slots with no enchant, in slot order', () => {
    const gear = [item(9), item(8), item(5, 1), item(1), item(16, 2), item(17)];
    const out = computeGear([row('Brisa', { gear, reported: true })]);
    expect(out.enchants).toEqual({
      checked: 1,
      unknown: 0,
      missingCount: 1,
      missing: [
        { name: 'Brisa', characterId: expect.any(String), slots: [8, 9] },
      ],
    });
  });

  it('an empty slot (no item) is not missing', () => {
    const empty: AddonSnapshotGearItem = { slot: 9, bonusIds: [] };
    expect(missingEnchantSlots([empty, item(8, 3)])).toEqual([]);
  });

  it('schema-1 gear is unknown, never missing; no gear is neither', () => {
    const out = computeGear([
      row('Old', { gear: [item(9)], reported: false }),
      row('NoFlag', { gear: [item(9)] }),
      row('NoGear', { ilvl: 60 }),
    ]);
    expect(out.enchants).toEqual({
      checked: 0,
      unknown: 2,
      missingCount: 0,
      missing: [],
    });
  });

  it('only cap mains are checked', () => {
    const gear = [item(9)];
    const out = computeGear([
      row('Low', { level: 40, gear, reported: true }),
      row('Alt', { isMain: false, gear, reported: true }),
      row('Unlinked', { linked: false, gear, reported: true }),
    ]);
    expect(out.enchants.checked).toBe(0);
    expect(out.enchants.missingCount).toBe(0);
  });

  it('missing is capped at 25 with the full total', () => {
    const rows = Array.from({ length: 27 }, (_, i) =>
      row(`m${i}`, { gear: [item(9)], reported: true }),
    );
    const out = computeGear(rows);
    expect(out.enchants.missingCount).toBe(27);
    expect(out.enchants.missing).toHaveLength(MAX_GEAR_MISSING);
    expect(WowRosterGearSchema.safeParse(out).success).toBe(true);
  });
});

describe('computeGear — freshness', () => {
  it('is the oldest ilvl/gear fact; null when none fed the card', () => {
    const out = computeGear([
      row('New', { ilvl: 60, asOf: T2 }),
      row('Old', { ilvl: 60, asOf: T1 }),
      row('Levelling', { level: 20, ilvl: 10, asOf: new Date('2020-01-01') }),
    ]);
    expect(out.freshness).toEqual({ source: 'addon', asOf: T1.toISOString() });
    expect(computeGear([row('Bare')]).freshness).toBeNull();
  });
});

describe('computeGear — ilvl through the addon snapshot fact source', () => {
  /** A main whose `ilvl` fact comes from a real AddonSnapshotFactSource load. */
  async function snapshotMain(gearIlvls: number[]): Promise<InsightRow> {
    const db = createDrizzleMock();
    const gear = gearIlvls.map((ilvl, i) => ({ ...item(i + 1), ilvl }));
    const data = {
      gear,
      talents: { nodes: [] },
      lockouts: [],
    };
    db.where.mockResolvedValue([
      { characterId: 'c1', data, capturedAt: T2, schema: 2, class: 'Mage' },
    ]);
    const ref = { key: 'm1', memberId: 1, characterId: 'c1' };
    const loaded = await new AddonSnapshotFactSource(db as never).load([ref]);
    const snapshot = must(loaded.get('m1'), 'snapshot facts');
    const base = row('Half');
    const level = fact(60, T2);
    return { ...base, facts: resolveFacts([{ level }, snapshot], T2, false) };
  }

  it('an exported 54.5 average is below the 55 floor and in the 50-54 bucket', async () => {
    const half = await snapshotMain([54, 55]);
    const out = computeGear([half, row('AtFloor', { ilvl: 55 })]);
    expect(out.ilvl.below.map((b) => b.name)).toEqual(['Half']);
    expect(out.ilvl.belowCount).toBe(1);
    expect(out.ilvl.buckets.map((b) => b.count)).toEqual([0, 0, 1, 1, 0, 0]);
  });
});
