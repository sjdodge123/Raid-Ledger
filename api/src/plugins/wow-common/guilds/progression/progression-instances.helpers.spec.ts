/**
 * ROK-1789 Part B (B-3) — pure grouping of a guild's pulls into raid
 * instance sections: map-id grouping, boss-name fallback, forever-over-
 * classic totals (Q-B11), "Instance <id>" + null total (Q-B12), B3
 * difficulty flag, the `other` bucket, and the near-duplicate collapse.
 */
import type { WowProgressionInstanceDto } from '@raid-ledger/contract';
import {
  groupIntoInstances,
  type ProgressionBossRow,
  type ProgressionPull,
} from './progression-instances.helpers';

const T0 = Date.parse('2026-10-22T20:00:00.000Z');
const at = (s: number): Date => new Date(T0 + s * 1000);
const iso = (s: number): string => at(s).toISOString();

/** A pull starting `start` s after T0, lasting 60 s, on map 409 (MC). */
function pull(
  encounterId: number,
  name: string,
  start: number,
  success: boolean,
  extra: Partial<ProgressionPull> = {},
): ProgressionPull {
  return {
    encounterId,
    encounterName: name,
    difficultyId: 9,
    instanceId: 409,
    startAt: at(start),
    endAt: at(start + 60),
    success,
    ...extra,
  };
}

const row = (
  instanceId: number,
  name: string,
  order: number,
  expansion = 'classic',
): ProgressionBossRow => ({ instanceId, name, order, expansion });

/** MC (Journal 741) as three classic boss rows. */
const MC_ROWS: ProgressionBossRow[] = [
  row(741, 'Lucifron', 1),
  row(741, 'Magmadar', 2),
  row(741, 'Gehennas', 3),
];

function only(
  instances: readonly WowProgressionInstanceDto[],
  key: string,
): WowProgressionInstanceDto {
  const found = instances.find((i) => i.key === key);
  if (!found)
    throw new Error(
      `no instance ${key} in ${instances.map((i) => i.key).join(',')}`,
    );
  return found;
}

describe('groupIntoInstances — empty', () => {
  it('has no instances, no pulls and no last pull', () => {
    expect(groupIntoInstances([], MC_ROWS)).toEqual({
      instances: [],
      pullCount: 0,
      lastPullAt: null,
    });
  });
});

describe('groupIntoInstances — instance resolution', () => {
  it('groups by pull map id via the raid table (409 → Molten Core, j:741)', () => {
    const out = groupIntoInstances(
      [pull(663, 'Lucifron', 0, true), pull(664, 'Magmadar', 300, false)],
      MC_ROWS,
    );
    expect(out.instances.map((i) => i.key)).toEqual(['j:741']);
    const mc = only(out.instances, 'j:741');
    expect(mc.name).toBe('Molten Core');
    expect(mc.bossTotal).toBe(3);
    expect(mc.bossesDown).toBe(1);
    expect(mc.bosses.map((b) => b.name)).toEqual(['Lucifron', 'Magmadar']);
  });

  it('falls back to a case-insensitive, trimmed boss-name match when the map id is null', () => {
    const out = groupIntoInstances(
      [pull(663, '  LUCIFRON ', 0, true, { instanceId: null })],
      MC_ROWS,
    );
    expect(out.instances.map((i) => i.key)).toEqual(['j:741']);
    expect(only(out.instances, 'j:741').name).toBe('Molten Core');
  });

  it('Q-B12: an unknown map id is "Instance <id>" with a null total', () => {
    const out = groupIntoInstances(
      [pull(9001, 'Frost Wyrm', 0, true, { instanceId: 9999 })],
      MC_ROWS,
    );
    const inst = only(out.instances, 'm:9999');
    expect(inst.name).toBe('Instance 9999');
    expect(inst.bossTotal).toBeNull();
    expect(inst.bosses[0]?.order).toBeNull();
  });

  it("a known raid without boss rows (Zul'Gurub) keeps its name and a null total", () => {
    const out = groupIntoInstances(
      [pull(785, 'Hakkar', 0, false, { instanceId: 309 })],
      MC_ROWS,
    );
    const zg = only(out.instances, 'm:309');
    expect(zg.name).toBe("Zul'Gurub");
    expect(zg.bossTotal).toBeNull();
  });
});

describe('groupIntoInstances — other bucket and split bosses', () => {
  it('an unknown boss with no map id lands in "Other bosses", sorted last even when newest', () => {
    const out = groupIntoInstances(
      [
        pull(663, 'Lucifron', 0, true),
        pull(5000, 'Mystery', 9000, true, { instanceId: null }),
      ],
      MC_ROWS,
    );
    expect(out.instances.map((i) => i.key)).toEqual(['j:741', 'other']);
    const other = only(out.instances, 'other');
    expect(other.name).toBe('Other bosses');
    expect(other.bossTotal).toBeNull();
  });

  it('one boss never splits: pulls with and without a map id share the instance', () => {
    const out = groupIntoInstances(
      [
        pull(5000, 'Mystery', 0, false, { instanceId: null }),
        pull(5000, 'Mystery', 600, true, { instanceId: 9999 }),
      ],
      [],
    );
    expect(out.instances.map((i) => i.key)).toEqual(['m:9999']);
  });
});

describe('groupIntoInstances — totals (Q-B11)', () => {
  it('prefers forever boss rows over classic for the total and order', () => {
    const rows = [
      ...MC_ROWS,
      row(741, 'Magmadar', 1, 'forever'),
      row(741, 'Lucifron', 2, 'forever'),
    ];
    const out = groupIntoInstances(
      [pull(663, 'Lucifron', 0, true), pull(664, 'Magmadar', 300, true)],
      rows,
    );
    const mc = only(out.instances, 'j:741');
    expect(mc.bossTotal).toBe(2);
    expect(mc.bosses.map((b) => [b.name, b.order])).toEqual([
      ['Magmadar', 1],
      ['Lucifron', 2],
    ]);
  });

  it('bosses down count only bosses with a boss row, so they never exceed the total', () => {
    const out = groupIntoInstances(
      [
        pull(663, 'Lucifron', 0, true),
        pull(664, 'Magmadar', 300, true),
        pull(665, 'Gehennas', 600, true),
        pull(7001, 'Core Hound Pack', 900, true),
      ],
      MC_ROWS,
    );
    const mc = only(out.instances, 'j:741');
    expect(mc.bosses).toHaveLength(4);
    expect([mc.bossesDown, mc.bossTotal]).toEqual([3, 3]);
  });

  it('with no boss rows (no total) every killed boss counts as down', () => {
    const out = groupIntoInstances(
      [pull(663, 'Lucifron', 0, true), pull(7001, 'Core Hound Pack', 9, true)],
      [],
    );
    const mc = only(out.instances, 'j:741');
    expect([mc.bossesDown, mc.bossTotal]).toEqual([2, null]);
  });

  it('ignores rows of other expansions', () => {
    const out = groupIntoInstances(
      [pull(663, 'Lucifron', 0, true)],
      [...MC_ROWS, row(741, 'Extra', 9, 'tbc')],
    );
    expect(only(out.instances, 'j:741').bossTotal).toBe(3);
  });
});

describe('groupIntoInstances — bosses and difficulty (B3)', () => {
  it('B3: showDifficulty is false for one difficulty, true for two', () => {
    const one = groupIntoInstances([pull(663, 'Lucifron', 0, true)], MC_ROWS);
    expect(only(one.instances, 'j:741').showDifficulty).toBe(false);
    const two = groupIntoInstances(
      [
        pull(663, 'Lucifron', 0, true),
        pull(663, 'Lucifron', 900, true, { difficultyId: 148 }),
      ],
      MC_ROWS,
    );
    expect(only(two.instances, 'j:741').showDifficulty).toBe(true);
  });

  it('bossesDown counts distinct encounters, any difficulty; rows per (encounter, difficulty)', () => {
    const out = groupIntoInstances(
      [
        pull(663, 'Lucifron', 0, true),
        pull(663, 'Lucifron', 900, true, { difficultyId: 148 }),
        pull(664, 'Magmadar', 1800, false),
      ],
      MC_ROWS,
    );
    const mc = only(out.instances, 'j:741');
    expect(mc.bossesDown).toBe(1);
    expect(mc.bosses).toHaveLength(3);
  });
});

describe('groupIntoInstances — boss order and latest kill', () => {
  it('orders bosses by boss-row order, unmatched bosses last', () => {
    const out = groupIntoInstances(
      [
        pull(9100, 'Not A Row', 0, true),
        pull(665, 'Gehennas', 100, true),
        pull(663, 'Lucifron', 200, true),
      ],
      MC_ROWS,
    );
    expect(
      only(out.instances, 'j:741').bosses.map((b) => [b.name, b.order]),
    ).toEqual([
      ['Lucifron', 1],
      ['Gehennas', 3],
      ['Not A Row', null],
    ]);
  });

  it('latestKill is the newest kill in the instance; null without kills', () => {
    const out = groupIntoInstances(
      [
        pull(663, 'Lucifron', 0, true),
        pull(664, 'Magmadar', 600, true),
        pull(665, 'Gehennas', 1200, false),
      ],
      MC_ROWS,
    );
    expect(only(out.instances, 'j:741').latestKill).toEqual({
      name: 'Magmadar',
      at: iso(660),
    });
    const wipes = groupIntoInstances(
      [pull(663, 'Lucifron', 0, false)],
      MC_ROWS,
    );
    expect(only(wipes.instances, 'j:741').latestKill).toBeNull();
  });
});

describe('groupIntoInstances — page totals and ordering', () => {
  it('still applies the near-duplicate collapse (two exporters 1 s apart = one pull)', () => {
    const out = groupIntoInstances(
      [pull(663, 'Lucifron', 0, false), pull(663, 'Lucifron', 1, true)],
      MC_ROWS,
    );
    expect(out.pullCount).toBe(1);
    expect(only(out.instances, 'j:741').bosses[0]?.kills).toBe(1);
  });

  it('sorts instances by most recent pull; page lastPullAt is the newest pull end', () => {
    const out = groupIntoInstances(
      [
        pull(663, 'Lucifron', 0, true),
        pull(610, 'Razorgore', 5000, false, { instanceId: 469 }),
        pull(785, 'Hakkar', 2000, false, { instanceId: 309 }),
      ],
      MC_ROWS,
    );
    expect(out.instances.map((i) => i.key)).toEqual([
      'j:742',
      'm:309',
      'j:741',
    ]);
    expect(out.pullCount).toBe(3);
    expect(out.lastPullAt).toBe(iso(5060));
  });
});
