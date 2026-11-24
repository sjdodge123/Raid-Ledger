/**
 * ROK-2317: one read-only check for every Discord DM that is sent directly
 * (outside the notification queue) but still belongs to a notification type.
 *
 * Same resolver as every queued path (`discordDisabledTypes` → stored
 * `channel_prefs` over the defaults), so a DM honours the row the member sees
 * in their notification settings. A recipient with no Raid Ledger account has
 * no switch to honour, so it is never muted.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import { discordDisabledTypes } from './notification-mapping.helpers';

/** Who the DM is for: a Raid Ledger user id, or a Discord user id. */
export type DiscordDmRecipient = { userId: number } | { discordId: string };

/**
 * True when the recipient's account has the Discord channel OFF for `type`.
 * No account ⇒ false. An account with no preferences row ⇒ the defaults.
 */
export async function isDiscordDmMuted(
  db: PostgresJsDatabase<typeof schema>,
  recipient: DiscordDmRecipient,
  type: NotificationType,
): Promise<boolean> {
  const prefs = schema.userNotificationPreferences;
  const match =
    'userId' in recipient
      ? eq(schema.users.id, recipient.userId)
      : eq(schema.users.discordId, recipient.discordId);
  const [row] = await db
    .select({ channelPrefs: prefs.channelPrefs })
    .from(schema.users)
    .leftJoin(prefs, eq(prefs.userId, schema.users.id))
    .where(match)
    .limit(1);
  if (!row) return false;
  return discordDisabledTypes(row.channelPrefs).has(type);
}
