import type { HubCommunityMemberRow } from './community-membership.queries';
import type { HubJoinPromptRow, TaggedHub } from './hub-join-prompts.queries';

/**
 * ROK-1893 P1 (§8d) — what one signup by `userId` on a hub-tagged event does.
 * Pure, so the whole decision table is unit-tested without a database.
 */
export type AutoMembershipAction = 'none' | 'suggest' | 'auto';

export interface AutoMembershipInput {
  /** The hub the event is tagged to; null for an untagged event. */
  hub: TaggedHub | null;
  /** Any `hub_community_members` row of the signer (live, left or banned). */
  membership: HubCommunityMemberRow | null;
  /** The signer's existing prompt on the hub, dismissed or not. */
  prompt: HubJoinPromptRow | null;
  /** The signer passes the Join rule's Discord-server check (R2). */
  inDiscord: boolean;
}

/** Only an active, unhidden `game_community` hub auto-recruits. */
export function isRecruitingHub(hub: TaggedHub | null): hub is TaggedHub {
  return (
    hub !== null &&
    hub.kind === 'game_community' &&
    hub.status === 'active' &&
    hub.hiddenAt === null &&
    hub.autoMembership !== 'off'
  );
}

/**
 * - off / untagged / hidden / not active / not a community hub → none
 * - any membership row (live, left, banned) → none: a member needs nothing,
 *   and someone who left or was banned is never re-added or re-asked
 * - a dismissed prompt → none ("Not now" sticks, in both modes)
 * - suggest → suggest (the insert is a no-op when a prompt is already open)
 * - auto → auto when the signer passes the Discord check, else suggest: the
 *   same R2 rule as Join, so the prompt's Join explains the missing step
 */
export function decideAutoMembership(
  input: AutoMembershipInput,
): AutoMembershipAction {
  const { hub } = input;
  if (!isRecruitingHub(hub)) return 'none';
  if (input.membership !== null) return 'none';
  if (input.prompt?.dismissedAt) return 'none';
  if (hub.autoMembership === 'suggest') return 'suggest';
  return input.inDiscord ? 'auto' : 'suggest';
}
