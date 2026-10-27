/**
 * ROK-2014 — the demo trend plan undone backwards from the fixture scan:
 * each day's totals minus the day before's equal the plan's gains.
 */
import { CONTAINERS_DEMO_MESSAGE } from './valheim-armory-containers-demo-fixture';
import { demoPriorDays } from './valheim-armory-container-days-demo.helpers';
import { dayItemTotals, itemSegKey } from './valheim-container-days.helpers';

const OWNER = '1000000000000001';
const totals = (msg: typeof CONTAINERS_DEMO_MESSAGE) => {
  const m = dayItemTotals(msg);
  return (prefab: string, vehicle = false, owner = '') =>
    m.get(itemSegKey({ prefab, vehicle, owner }))?.total ?? 0;
};

describe('demoPriorDays (ROK-2014 trendDays: 3)', () => {
  const prior = demoPriorDays(CONTAINERS_DEMO_MESSAGE);
  const ends = [CONTAINERS_DEMO_MESSAGE, ...prior.map((d) => d.msg)].map(
    totals,
  );
  const delta = (
    i: number,
    prefab: string,
    vehicle?: boolean,
    owner?: string,
  ) => {
    const newer = ends[i];
    const older = ends[i + 1];
    if (!newer || !older) throw new Error(`no day ${i}`);
    return newer(prefab, vehicle, owner) - older(prefab, vehicle, owner);
  };

  it('dates three earlier days at scan −1, −3, −6', () => {
    expect(prior.map((d) => d.daysAgo)).toEqual([1, 3, 6]);
  });

  it('shared Wood gains +20, +15, +10 (+45) and cart Wood +40 on day −1', () => {
    expect([0, 1, 2].map((i) => delta(i, 'Wood'))).toEqual([20, 15, 10]);
    expect([0, 1, 2].map((i) => delta(i, 'Wood', true))).toEqual([0, 40, 0]);
  });

  it('Stone drops 10 on the scan day; Coins (personal) +100; BlackMetal +60', () => {
    expect(delta(0, 'Stone')).toBe(-10);
    expect(delta(1, 'Coins', false, OWNER)).toBe(100);
    expect(delta(2, 'BlackMetal')).toBe(60);
  });

  it('leaves every other item unchanged across the window', () => {
    for (const i of [0, 1, 2]) {
      expect(delta(i, 'Resin')).toBe(0);
      expect(delta(i, 'SwordIron')).toBe(0);
    }
  });
});
