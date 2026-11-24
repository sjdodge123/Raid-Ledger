/**
 * ROK-2305: the member-invite DM honours the invitee's Discord switch.
 *
 * The invite rides on the `new_event` notification type. Its bell row follows
 * `resolveDelivery` (event-invite-claim.helpers.ts), but the DM is sent by the
 * bot from `MEMBER_INVITE_EVENTS.CREATED`, which never read the Discord
 * channel — so a member with Discord OFF for invites still got the DM.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { NotificationType } from '../../drizzle/schema/notification-preferences';
import { discordDisabledTypes } from '../../notifications/notification-mapping.helpers';

/** The notification type a member invite is stored and switched under. */
export const MEMBER_INVITE_NOTIFICATION_TYPE: NotificationType = 'new_event';

/**
 * True when the Raid Ledger account linked to `discordId` has the Discord
 * channel OFF for the invite type. Same resolver as every other DM path
 * (`discordDisabledTypes`: no row ⇒ defaults). A Discord user with no account
 * has no switch to honour, so it is never muted.
 */
export async function isMemberInviteDmMuted(
  db: PostgresJsDatabase<typeof schema>,
  discordId: string,
): Promise<boolean> {
  const prefs = schema.userNotificationPreferences;
  const [row] = await db
    .select({ channelPrefs: prefs.channelPrefs })
    .from(schema.users)
    .leftJoin(prefs, eq(prefs.userId, schema.users.id))
    .where(eq(schema.users.discordId, discordId))
    .limit(1);
  if (!row) return false;
  return discordDisabledTypes(row.channelPrefs).has(
    MEMBER_INVITE_NOTIFICATION_TYPE,
  );
}
