/**
 * ROK-2352 P2-2 — coverage is a maximum assignment of distinct members to
 * roster slots, one slot each, by the roles they ticked.
 */
import { assignRoleCoverage } from './wow-lfg-coverage.helpers';

const FIVE = { tank: 1, healer: 1, dps: 3 };

describe('assignRoleCoverage (ROK-2352 §3.4)', () => {
  it('fills a 5-man shape from tank, healer and three dps', () => {
    expect(
      assignRoleCoverage(FIVE, [
        ['tank'],
        ['healer'],
        ['dps'],
        ['dps'],
        ['dps'],
      ]),
    ).toEqual(FIVE);
  });

  it('never seats a member twice or above the shape', () => {
    expect(
      assignRoleCoverage(FIVE, [['tank', 'healer', 'dps'], ['dps'], ['dps']]),
    ).toEqual({ tank: 1, healer: 0, dps: 2 });
    expect(assignRoleCoverage(FIVE, [['tank'], ['tank'], ['tank']])).toEqual({
      tank: 1,
      healer: 0,
      dps: 0,
    });
  });

  // A greedy first-fit seats the tank/healer member as tank and leaves the
  // healer slot empty; the augmenting path moves them to free it.
  it('re-seats a flexible member so a single-role one can fill', () => {
    expect(assignRoleCoverage(FIVE, [['tank', 'healer'], ['tank']])).toEqual({
      tank: 1,
      healer: 1,
      dps: 0,
    });
  });

  it('counts nothing for a member with no role set', () => {
    expect(assignRoleCoverage(FIVE, [[], ['dps']])).toEqual({
      tank: 0,
      healer: 0,
      dps: 1,
    });
  });
});
