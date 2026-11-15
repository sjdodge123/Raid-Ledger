/**
 * ROK-2210 (Codex P2): a shared Wowhead zone (Dire Maul 2557, Stratholme
 * 2017) covers every wing's bosses, not just the parent row's.
 */
import bossData from '../data/boss-encounter-data.json';
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
