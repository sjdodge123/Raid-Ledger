/**
 * Client-side mirror of the server's assertUserCanParticipate (ROK-1065).
 * Authoritative check is still server-side; this lets the UI disable
 * write actions (nominate / vote) for non-invitees on private lineups.
 */
import type { LineupDetailResponseDto } from '@raid-ledger/contract';

interface ParticipantUser {
  id: number;
  role?: string;
}

/**
 * The exact lineup fields eligibility needs (ROK-1349).
 *
 * Deliberately a NON-optional shape pinned to the detail DTO's field types:
 * `createdBy` and `invitees` only exist on `LineupDetailResponseDto`, NOT on
 * `LineupSummaryResponseDto` (the `/lineups/active` list shape). Requiring
 * them here makes it a COMPILE error to pass a summary-shaped lineup into
 * eligibility — a private lineup fed a summary would otherwise read as
 * "not invited" for every non-admin viewer and disable every nominate card
 * (ROK-1349 Part B failure mode). Do not loosen these to optional.
 */
export type EligibilityLineup = Pick<
  LineupDetailResponseDto,
  'visibility' | 'createdBy' | 'invitees'
>;

/**
 * Returns true when the viewer can nominate / vote on the given lineup:
 * public lineups are always writable; private lineups only by admins,
 * operators, the creator, or explicit invitees.
 */
export function canParticipateInLineup(
  lineup: EligibilityLineup | null | undefined,
  user: ParticipantUser | null | undefined,
): boolean {
  if (!lineup) return false;
  if (lineup.visibility === 'public') return true;
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'operator') return true;
  if (lineup.createdBy.id === user.id) return true;
  return lineup.invitees.some((i) => i.id === user.id);
}
