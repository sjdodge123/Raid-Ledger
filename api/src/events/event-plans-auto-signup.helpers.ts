/**
 * Auto-signup poll voters when an event is created from a scheduling-poll plan
 * (ROK-1379 follow-up; mirrors ROK-1031's lineups autoSignupSlotVoters).
 *
 * Before this helper, only the plan creator was signed up at poll close —
 * every other voter had to re-signup manually via the event embed, and voters
 * who missed the embed silently fell off the roster.
 */
import { Logger } from '@nestjs/common';
import { and, inArray, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { SignupsService } from './signups.service';

const logger = new Logger('EventPlansAutoSignup');

/** Parameters for the poll-voter auto-signup helper. */
export interface AutoSignupPollVotersParams {
  db: PostgresJsDatabase<typeof schema>;
  signupsService: Pick<SignupsService, 'signup'>;
  eventId: number;
  creatorId: number;
  /** Discord IDs of registered users who voted for the winning option. */
  voterDiscordIds: string[];
}

/**
 * Sign up the winning option's registered voters for the newly created event.
 * Skips the creator (already signed up at plan close), deduplicates, and
 * excludes deactivated / banned / kicked users (ROK-313 conventions).
 * Best-effort: no failure here may propagate — the event and plan are already
 * finalized, and a throw would incorrectly expire the completed plan.
 */
export async function autoSignupPollVoters(
  params: AutoSignupPollVotersParams,
): Promise<void> {
  const { db, signupsService, eventId, creatorId, voterDiscordIds } = params;
  if (voterDiscordIds.length === 0) return;
  try {
    const voters = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          inArray(schema.users.discordId, [...new Set(voterDiscordIds)]),
          isNull(schema.users.deactivatedAt),
          isNull(schema.users.bannedAt),
          isNull(schema.users.kickedAt),
        ),
      );
    const userIds = [...new Set(voters.map((v) => v.id))].filter(
      (id): id is number => id != null && id !== creatorId,
    );
    for (const userId of userIds) {
      try {
        await signupsService.signup(eventId, userId);
      } catch (error) {
        logger.warn(
          `Auto-signup failed for user ${userId} on event ${eventId}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      }
    }
    if (userIds.length > 0) {
      logger.log(
        `Auto-signed ${userIds.length} winning-option voter(s) for event ${eventId}`,
      );
    }
  } catch (error) {
    logger.warn(
      `Auto-signup voter resolution failed for event ${eventId}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }
}
