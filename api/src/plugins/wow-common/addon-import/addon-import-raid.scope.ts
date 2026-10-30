import type { AddonImportResultDto } from '@raid-ledger/contract';
import type { PullScope } from '../guilds/roster-insights/roster-insights.pull-scope';
import type { PasteSectionRun } from './addon-import.paste-run';
import { guildNameKey } from './addon-import-apply.types';

/**
 * ROK-1917 final P2 — the pull scope of an applied raid section, carried on
 * the import result under a symbol (never serialised; survives the create
 * route's spreads) so the post-commit hook can invalidate the raid-progress
 * cache of every `wow_guild` hub in it. Mirrors `SNAPSHOT_UNCHANGED`.
 */
export const RAID_PULL_SCOPE = Symbol('addon-import.raidPullScope');

/** An import result that may carry its raid pull scope. */
export type WithRaidPullScope<T> = T & { [RAID_PULL_SCOPE]?: PullScope };

/** The applied raid section's scope; undefined when nothing guilded was written. */
export function raidPullScope(
  runs: readonly PasteSectionRun[],
  ctx: { gameId: number; region: string },
): PullScope | undefined {
  const raid = runs.find((r) => r.decoded.payload.section === 'raid');
  if (!raid || raid.outcome.status !== 'applied') return undefined;
  const payload = raid.decoded.payload;
  const name = payload.section === 'raid' ? payload.who.guildName : undefined;
  const guildKey = guildNameKey(name);
  if (guildKey === '') return undefined;
  return { gameId: ctx.gameId, region: ctx.region, guildKey };
}

/** Attach `scope` to the result (unchanged when there is none). */
export function withRaidPullScope<T extends AddonImportResultDto>(
  res: T,
  scope: PullScope | undefined,
): WithRaidPullScope<T> {
  if (!scope) return res;
  return { ...res, [RAID_PULL_SCOPE]: scope };
}

/** The raid pull scope an import result carries, if any (post-commit hook). */
export function readRaidPullScope(
  res: WithRaidPullScope<object>,
): PullScope | undefined {
  return res[RAID_PULL_SCOPE];
}
