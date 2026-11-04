/**
 * D6 community membership (ROK-1939): only ACTIVE users whose dimensions
 * are not all zero count toward the community stats.
 */
import {
  TASTE_PROFILE_AXIS_POOL,
  type TasteProfileDimensionsDto,
} from '@raid-ledger/contract';
import { computeCommunityAxisStats } from './archetype-community.helpers';
import { communityFromRows } from './archetype-retitle-all.helpers';

function dims(
  overrides: Partial<TasteProfileDimensionsDto> = {},
): TasteProfileDimensionsDto {
  const base: Record<string, number> = {};
  for (const axis of TASTE_PROFILE_AXIS_POOL) base[axis] = 0;
  return { ...(base as TasteProfileDimensionsDto), ...overrides };
}

const RPG = dims({ rpg: 100 });
const PVP = dims({ pvp: 100, shooter: 40 });

describe('communityFromRows — D6 filters', () => {
  it('excludes a deactivated user from the community', () => {
    const stats = communityFromRows([
      { active: true, dimensions: RPG },
      { active: false, dimensions: PVP },
    ]);
    expect(stats.size).toBe(1);
    expect(stats).toEqual(computeCommunityAxisStats([RPG]));
  });

  it('excludes an all-zero profile from the community', () => {
    const stats = communityFromRows([
      { active: true, dimensions: RPG },
      { active: true, dimensions: dims() },
    ]);
    expect(stats.size).toBe(1);
    expect(stats).toEqual(computeCommunityAxisStats([RPG]));
  });

  it('keeps every active profile with any signal', () => {
    const stats = communityFromRows([
      { active: true, dimensions: RPG },
      { active: true, dimensions: PVP },
    ]);
    expect(stats.size).toBe(2);
  });
});
