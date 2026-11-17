import type {
  SuggestedGroupDto,
  SuggestedGroupsDto,
  SuggestedGroupsQuery,
} from '@raid-ledger/contract';
import type { InsightsAudience } from '../roster-insights/roster-insights.types';
import { pickTop } from './suggested-groups.helpers';

/**
 * ROK-2212 — shape one cached computation for one request: scope + dungeon
 * filter, then the audience mask (L9). Pure.
 */

/** Contract cap on `groups`. */
const MAX_GROUPS = 400;

/** 5 minutes (L10), the roster-insights TTL. */
export const SUGGESTED_GROUPS_TTL_MS = 5 * 60 * 1000;

/** Cache namespace: `memorySwr` tracks in-flight refreshes by key, process-wide. */
export const SUGGESTED_GROUPS_KEY_PREFIX = 'sg:';

export function suggestedGroupsKey(guildId: number): string {
  return `${SUGGESTED_GROUPS_KEY_PREFIX}${guildId}`;
}

/** One guild's unmasked groups (every dungeon, ranked within each). */
export type ComputedGroups = SuggestedGroupsDto;

/** L9: a visitor never sees who plays a character — mask AFTER grouping. */
export function maskGroup(group: SuggestedGroupDto): SuggestedGroupDto {
  return {
    ...group,
    members: group.members.map((m) => ({ ...m, userId: null })),
  };
}

/** Scope `top` = best of 3 distinct dungeons; `all` = every lineup kept. */
export function presentGroups(
  computed: ComputedGroups,
  query: SuggestedGroupsQuery,
  audience: InsightsAudience,
): SuggestedGroupsDto {
  const { instanceId } = query;
  const scoped =
    instanceId === undefined
      ? computed.groups
      : computed.groups.filter((g) => g.instance.id === instanceId);
  const picked =
    query.scope === 'top' ? pickTop(scoped) : scoped.slice(0, MAX_GROUPS);
  return {
    groups: audience === 'visitor' ? picked.map(maskGroup) : picked,
    pool: computed.pool,
    generatedAt: computed.generatedAt,
  };
}
