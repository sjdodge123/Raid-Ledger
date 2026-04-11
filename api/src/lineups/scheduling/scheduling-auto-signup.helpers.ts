/**
 * Auto-signup poll voters when an event is created from a schedule slot (ROK-1031).
 * Signs up each voter for the newly created event, skipping the creator
 * (who is already signed up via event creation).
 */
import type { SignupsService } from '../../events/signups.service';
import type { ScheduleVoteRow } from './scheduling-query.helpers';

/** Parameters for the auto-signup helper. */
export interface AutoSignupParams {
  eventId: number;
  creatorId: number;
  voters: ScheduleVoteRow[];
  signupsService: Pick<SignupsService, 'signup'>;
}

/**
 * Auto-sign up poll voters for a newly created event.
 * Skips the event creator (already signed up) and deduplicates voters
 * who may appear multiple times across slots.
 * Individual signup failures are caught and swallowed so that one
 * failure does not prevent other voters from being signed up.
 * @param params - Auto-signup parameters
 */
export async function autoSignupSlotVoters(
  params: AutoSignupParams,
): Promise<void> {
  const { eventId, creatorId, voters, signupsService } = params;
  const uniqueUserIds = [...new Set(voters.map((v) => v.userId))].filter(
    (uid) => uid !== creatorId,
  );

  for (const userId of uniqueUserIds) {
    try {
      await signupsService.signup(eventId, userId);
    } catch {
      // Individual signup failures are swallowed intentionally
    }
  }
}
