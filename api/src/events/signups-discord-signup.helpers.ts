/**
 * Discord signup orchestration helper for SignupsService.
 * Extracted from signups.service.ts for file size compliance (ROK-746).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type {
  SignupResponseDto,
  CreateDiscordSignupDto,
} from '@raid-ledger/contract';
import type { FlowDeps } from './signups-flow.helpers';
import * as discordH from './signups-discord.helpers';
import * as rosterH from './signups-roster.helpers';
import * as cancelH from './signups-cancel.helpers';
import * as flowH from './signups-flow.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Run the anonymous Discord signup flow (no linked user). */
export async function anonymousDiscordSignup(
  db: Db,
  flowDeps: FlowDeps,
  eventId: number,
  dto: CreateDiscordSignupDto,
): Promise<{ response: SignupResponseDto; signupId: number }> {
  const event = await cancelH.fetchEventOrThrow(db, eventId);
  cancelH.assertEventAcceptingSignups(event);
  const result = await db.transaction((tx) =>
    flowH.discordSignupTxBody(flowDeps, tx, event, eventId, dto),
  );
  return {
    response: rosterH.buildAnonymousSignupResponseDto(
      result.signup,
      result.assignedSlot ?? undefined,
    ),
    signupId: result.signup.id,
  };
}

/** Check if a Discord user has a linked account. */
export async function findLinkedUserForDiscord(db: Db, discordUserId: string) {
  return discordH.findLinkedUser(db, discordUserId);
}
