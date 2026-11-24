/**
 * ROK-2305: the member-invite DM honours the invitee's Discord switch.
 *
 * The invite rides on the `new_event` notification type. Its bell row follows
 * `resolveDelivery` (event-invite-claim.helpers.ts), but the DM is sent by the
 * bot from `MEMBER_INVITE_EVENTS.CREATED`, which never read the Discord
 * channel — so a member with Discord OFF for invites still got the DM.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { NotificationType } from '../../drizzle/schema/notification-preferences';
import { isDiscordDmMuted } from '../../notifications/discord-dm-mute.helpers';

/** The notification type a member invite is stored and switched under. */
export const MEMBER_INVITE_NOTIFICATION_TYPE: NotificationType = 'new_event';

/**
 * True when the Raid Ledger account linked to `discordId` has the Discord
 * channel OFF for the invite type. Same resolver as every other DM path
 * (`discordDisabledTypes`: no row ⇒ defaults). A Discord user with no account
 * has no switch to honour, so it is never muted. ROK-2317: delegates to the
 * shared `isDiscordDmMuted`.
 */
export async function isMemberInviteDmMuted(
  db: PostgresJsDatabase<typeof schema>,
  discordId: string,
): Promise<boolean> {
  return isDiscordDmMuted(db, { discordId }, MEMBER_INVITE_NOTIFICATION_TYPE);
}
