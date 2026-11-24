/**
 * Discord signup orchestration helper for SignupsService.
 * Extracted from signups.service.ts for file size compliance (ROK-746).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { defined } from '../common/defined.helpers';
import type {
  SignupResponseDto,
  CreateDiscordSignupDto,
} from '@raid-ledger/contract';
import type { FlowDeps } from './signups-flow.helpers';
import {
  accountBlockedError,
  resolveDiscordAccount,
  type UserRow,
} from '../users/discord-account-status.helpers';
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
  const signup = defined(result.signup, 'discord signup row');
  return {
    response: rosterH.buildAnonymousSignupResponseDto(
      signup,
      result.assignedSlot ?? undefined,
    ),
    signupId: signup.id,
  };
}

/**
 * Linked user for a Discord id, or null when unlinked (→ anonymous signup).
 * ROK-2298: a blocked account throws `ACCOUNT_BLOCKED` instead of returning
 * null, so a banned Discord id can never fall through to an anonymous row.
 */
export async function findLinkedUserForDiscord(
  db: Db,
  discordUserId: string,
): Promise<UserRow | null> {
  const account = await resolveDiscordAccount(db, discordUserId);
  if (account.kind === 'blocked') throw accountBlockedError();
  return account.kind === 'linked' ? account.user : null;
}
