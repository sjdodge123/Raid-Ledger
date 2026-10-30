/**
 * ROK-1917 final P2 — an applied raid section marks the import result with
 * its pull scope, so the post-commit hook can drop the raid-progress cache of
 * every `wow_guild` hub in that scope (an alt with no `guild_members` row
 * finds no guild through `invalidateForCharacter`).
 */
import type { AddonImportResultDto } from '@raid-ledger/contract';
import type { PasteSectionRun } from './addon-import.paste-run';
import {
  RAID_PULL_SCOPE,
  raidPullScope,
  withRaidPullScope,
} from './addon-import-raid.scope';

const ctx = { gameId: 3, region: 'eu' as const };

function raidRun(status: string, guildName = ' My Guild '): PasteSectionRun {
  return {
    decoded: { payload: { section: 'raid', who: { guildName } } },
    outcome: { status },
  } as unknown as PasteSectionRun;
}

const charRun = { ...raidRun('applied'), decoded: { payload: { section: 'char' } } } as unknown as PasteSectionRun;

describe('raidPullScope (ROK-1917 final P2)', () => {
  it("is the applied raid section's (game, region, guild key)", () => {
    expect(raidPullScope([charRun, raidRun('applied')], ctx)).toEqual({
      gameId: 3,
      region: 'eu',
      guildKey: 'my guild',
    });
  });

  it.each(['noop', 'stale', 'preview'])('is undefined for a %s raid section', (status) => {
    expect(raidPullScope([raidRun(status)], ctx)).toBeUndefined();
  });

  it('is undefined without a raid section or for unguilded pulls', () => {
    expect(raidPullScope([charRun], ctx)).toBeUndefined();
    expect(raidPullScope([raidRun('applied', '')], ctx)).toBeUndefined();
  });
});

describe('withRaidPullScope', () => {
  const res = { status: 'applied' } as unknown as AddonImportResultDto;

  it('rides on the result under a symbol and survives a spread', () => {
    const scope = { gameId: 3, region: 'eu', guildKey: 'g' };
    const marked = { ...withRaidPullScope(res, scope), target: {} };
    expect(marked[RAID_PULL_SCOPE]).toEqual(scope);
    expect(JSON.parse(JSON.stringify(marked))).toEqual({ status: 'applied', target: {} });
  });

  it('leaves the result untouched without a scope', () => {
    expect(withRaidPullScope(res, undefined)).toBe(res);
  });
});
