import type { CreateNotificationInput } from '../../notifications/notification.types';

/**
 * ROK-1870 L2b — the `hub_proposal_submitted` / `hub_proposal_reviewed`
 * notices. Payloads are self-contained (gameName + hubName) so a rejected,
 * deleted row is never dereferenced (§2.4 reject).
 */

/** Where staff review proposals (§2.4 propose). */
export const HUB_PROPOSALS_ADMIN_URL = '/admin/settings/general/hubs';

/** What a notice says about the proposal. */
export interface ProposalNoticeFacts {
  proposalId: number;
  gameName: string;
  hubName: string;
}

/** `hub_proposal_submitted` to one staff user. */
export function submittedNotice(
  staffId: number,
  facts: ProposalNoticeFacts,
  proposerName: string,
): CreateNotificationInput {
  return {
    userId: staffId,
    type: 'hub_proposal_submitted',
    title: `New hub proposal: ${facts.hubName}`,
    message: `${proposerName} proposed "${facts.hubName}" for ${facts.gameName}.`,
    payload: { ...facts, url: HUB_PROPOSALS_ADMIN_URL },
  };
}

/** `hub_proposal_reviewed` (approved) — links the proposer to their hub. */
export function approvedNotice(
  proposerId: number,
  facts: ProposalNoticeFacts,
): CreateNotificationInput {
  return {
    userId: proposerId,
    type: 'hub_proposal_reviewed',
    title: `Your hub "${facts.hubName}" is live`,
    message: `You lead ${facts.hubName} for ${facts.gameName} — invite people to join.`,
    payload: {
      ...facts,
      outcome: 'approved',
      guildId: facts.proposalId,
      url: `/guilds/${facts.proposalId}`,
    },
  };
}

/** `hub_proposal_reviewed` (rejected) — carries the admin's reason. */
export function rejectedNotice(
  proposerId: number,
  facts: ProposalNoticeFacts,
  reason: string,
): CreateNotificationInput {
  return {
    userId: proposerId,
    type: 'hub_proposal_reviewed',
    title: `Your hub proposal "${facts.hubName}" was declined`,
    message: reason,
    payload: { ...facts, outcome: 'rejected', reason },
  };
}
