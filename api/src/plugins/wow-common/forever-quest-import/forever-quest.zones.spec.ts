import { FOREVER_INSTANCES } from '../forever-instance-data';
import { FOREVER_WOWHEAD_ZONES, unmappedZones } from './forever-quest.zones';

describe('FOREVER_WOWHEAD_ZONES', () => {
  it('has one entry per Forever seed instance', () => {
    expect(Object.keys(FOREVER_WOWHEAD_ZONES)).toHaveLength(
      FOREVER_INSTANCES.length,
    );
  });

  it('reports only the seed ns still without a Wowhead zone id', () => {
    expect(unmappedZones()).toEqual([5, 6, 7, 8, 9, 10, 11]);
  });
});
