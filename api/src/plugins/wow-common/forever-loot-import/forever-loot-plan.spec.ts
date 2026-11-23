/**
 * ROK-2210 (Codex P2): a shared Wowhead zone (Dire Maul 2557, Stratholme
 * 2017) covers every wing's bosses, not just the parent row's.
 */
import bossData from '../data/boss-encounter-data.json';
import lootData from '../data/boss-loot-data.json';
import {
  planCapture,
  type BossRow,
  type Capture,
  type CaptureDrop,
} from './forever-loot-plan';

const BOSSES: BossRow[] = bossData.map((b) => ({
  name: b.name,
  instanceId: b.instanceId,
  expansion: b.expansion,
}));

function drop(itemId: number, source: string): CaptureDrop {
  return { itemId, name: `Item ${itemId}`, quality: 3, icon: 'inv_x', source };
}

function capture(zone: string, zoneId: number, drops: CaptureDrop[]): Capture {
  return { zone, zoneId, totalShown: drops.length, drops };
}

const bossesOf = (c: Capture): string[] =>
  planCapture(c, BOSSES).rows.map((r) => r.bossName);

describe('planCapture — shared Wowhead zones (ROK-2210)', () => {
  it('imports a Dire Maul East boss (Hydrospawn) next to a West one', () => {
    const c = capture('Dire Maul', 2557, [
      drop(18317, 'Hydrospawn'),
      drop(18301, 'Tendris Warpwood'),
    ]);
    expect(bossesOf(c)).toEqual(['Hydrospawn', 'Tendris Warpwood']);
    expect(planCapture(c, BOSSES).skipped).toEqual([]);
  });

  it('imports a Stratholme Service Entrance boss next to a Main Gate one', () => {
    const c = capture('Stratholme', 2017, [
      drop(13349, 'Baron Rivendare'),
      drop(13400, 'Ramstein the Gorger'),
      drop(13401, 'Timmy the Cruel'),
    ]);
    expect(bossesOf(c)).toEqual([
      'Baron Rivendare',
      'Ramstein the Gorger',
      'Timmy the Cruel',
    ]);
  });

  it('still skips a source that is not a listed boss of the zone', () => {
    const c = capture('Stratholme', 2017, [drop(1, 'Hydrospawn')]);
    const plan = planCapture(c, BOSSES);
    expect(plan.rows).toEqual([]);
    expect(plan.skipped.map((d) => d.itemId)).toEqual([1]);
  });

  it('rejects a zone with no catalogue instance', () => {
    expect(() => planCapture(capture('Nowhere', 1, []), BOSSES)).toThrow(
      'no instance mapping for zone 1',
    );
  });
});

describe('planCapture — rows carry the listed boss instanceId (ROK-2209)', () => {
  const idsOf = (c: Capture, bosses: BossRow[] = BOSSES) =>
    planCapture(c, bosses).rows.map((r) => [r.bossName, r.instanceId]);

  it('writes each wing boss its own instance (Dire Maul East 1276, West 230)', () => {
    const c = capture('Dire Maul', 2557, [
      drop(18317, 'Hydrospawn'),
      drop(18301, 'Tendris Warpwood'),
    ]);
    expect(idsOf(c)).toEqual([
      ['Hydrospawn', 1276],
      ['Tendris Warpwood', 230],
    ]);
  });

  it('writes the Stratholme Service Entrance boss 1292 and Main Gate 236', () => {
    const c = capture('Stratholme', 2017, [
      drop(13349, 'Baron Rivendare'),
      drop(13401, 'Timmy the Cruel'),
    ]);
    expect(idsOf(c)).toEqual([
      ['Baron Rivendare', 1292],
      ['Timmy the Cruel', 236],
    ]);
  });

  it('refuses a boss name listed on two instances of the zone', () => {
    const twin: BossRow = { ...must(BOSSES, 'Hydrospawn'), instanceId: 230 };
    const c = capture('Dire Maul', 2557, [drop(18317, 'Hydrospawn')]);
    expect(() => planCapture(c, [...BOSSES, twin])).toThrow(
      'Hydrospawn is not listed on exactly one instance of the zone',
    );
  });
});

describe('planCapture — Forever-new dungeons (ROK-2270)', () => {
  it('attaches a Ruins of Lordaeron drop to the forever boss row 90000002', () => {
    const c = capture('Ruins of Lordaeron', 16611, [
      drop(271223, 'Viktor the Vile'),
    ]);
    const plan = planCapture(c, BOSSES);
    expect(
      plan.rows.map((r) => [r.bossName, r.instanceId, r.expansion]),
    ).toEqual([['Viktor the Vile', 90000002, 'forever']]);
  });

  it('skips a source that is not one of our boss names (no guessing)', () => {
    const c = capture('Ruins of Lordaeron', 16611, [
      drop(271204, 'The Baron'),
      drop(286977, 'Zone Drop'),
    ]);
    const plan = planCapture(c, BOSSES);
    expect(plan.rows).toEqual([]);
    expect(plan.skipped.map((d) => d.source)).toEqual([
      'The Baron',
      'Zone Drop',
    ]);
  });
});

describe('boss-loot-data.json — Forever-new imports (ROK-2270)', () => {
  const foreverRowsOf = (boss: string) =>
    lootData.filter((l) => l.bossName === boss && l.expansion === 'forever');

  it("carries Viktor the Vile's captured drops on Ruins of Lordaeron", () => {
    const rows = foreverRowsOf('Viktor the Vile');
    expect(rows.map((l) => l.instanceId)).toEqual([
      90000002, 90000002, 90000002,
    ]);
  });

  it('carries nothing for bosses the capture did not name', () => {
    for (const boss of ['The Butcher', 'Lordaeron Captain', 'Infurnus']) {
      expect([boss, foreverRowsOf(boss).length]).toEqual([boss, 0]);
    }
  });
});

/**
 * boss name -> forever row count for one Forever-new instance. Returned as a
 * plain object so `toEqual` ignores the JSON's capture order.
 */
function perBossCounts(instanceId: number): Record<string, number> {
  const counts = new Map<string, number>();
  for (const l of lootData) {
    if (l.instanceId !== instanceId || l.expansion !== 'forever') continue;
    const name = String(l.bossName);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

describe('boss-loot-data.json — Alcaz Prison and Blackmaw Hold (ROK-2270 batch 2)', () => {
  it('carries Alcaz Prison (90000007) drops for all five bosses', () => {
    expect(perBossCounts(90000007)).toEqual({
      'Overseer Wrex': 3,
      "Tidemistress Ca'zass": 3,
      'Katerina the Cleaner': 3,
      'The Questioner': 3,
      Blazeroar: 3,
    });
  });

  it('carries Blackmaw Hold (90000008) drops for six of seven bosses', () => {
    expect(perBossCounts(90000008)).toEqual({
      Withermaw: 3,
      'Impaan the Imprisoner': 3,
      'Elder Shaman Bloodmane': 4,
      'Bonesnout the Unbroken': 3,
      'Varrox Bleakhoof': 3,
      'Unbound Spirit': 3,
    });
  });

  it('carries nothing for Blackmaw Behemoth (not on the capture)', () => {
    expect(foreverRowsOfBoss('Blackmaw Behemoth')).toEqual([]);
  });

  it('imports no trash, rare or zone-drop source from either capture', () => {
    const unmatched = [
      'Alcaz Jailer',
      'Strashaz Enchantress',
      'Zone Drop',
      'Legashi Summoner',
      'Blackmaw Druid',
      'Gortek the Apprentice',
      'Moontouched Wanderer',
      'Mopes',
      'Tunnelweb Matriarch',
    ];
    const hits = lootData.filter((l) =>
      unmatched.some((n) => n === l.bossName),
    );
    expect(hits.map((l) => l.bossName)).toEqual([]);
  });
});

function foreverRowsOfBoss(boss: string): number[] {
  return lootData
    .filter((l) => l.bossName === boss && l.expansion === 'forever')
    .map((l) => l.itemId);
}

function must(rows: BossRow[], name: string): BossRow {
  const row = rows.find((b) => b.name === name && b.expansion === 'classic');
  if (!row) throw new Error(`fixture boss ${name} missing`);
  return row;
}
