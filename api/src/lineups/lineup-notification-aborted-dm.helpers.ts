/**
 * Private-lineup ABORTED DM fan-out (ROK-1528).
 *
 * A private lineup suppresses every channel embed, and the abort card was the
 * last one that did not — aborting leaked the lineup's title, description and
 * existence into the public/default channel. Invitees now hear about it on
 * the same DM surface as every other private-lineup notification.
 *
 * Kept in its own file so neither the abort orchestrator nor
 * `lineup-notification-private-dm.helpers.ts` grows past the 300-line ceiling.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { NotificationService } from '../notifications/notification.service';
import type { NotificationDedupService } from '../notifications/notification-dedup.service';
import type { DiscordMember } from './lineup-notification-dm.helpers';
import { findInviteeDiscordMembers } from './lineup-notification-targets.helpers';
import { DEDUP_TTL } from './lineup-notification.constants';
import type { LineupInfo } from './lineup-notification.service';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Body of the abort DM, mirroring the channel embed's wording so a private
 * invitee reads the same sentence a public member would have seen.
 *
 * @param reason - Operator-supplied reason; appended only when non-blank.
 * @param actorDisplayName - Who aborted the lineup.
 * @returns The DM message body.
 */
function abortedDmMessage(
  reason: string | null | undefined,
  actorDisplayName: string,
): string {
  const trimmed = reason?.trim() ?? '';
  return (
    `Your private lineup was aborted by **${actorDisplayName}**.` +
    (trimmed ? `\n\n${trimmed}` : '')
  );
}

/**
 * Send the per-invitee lineup-aborted DM (ROK-1528).
 *
 * @param notificationService - Delivery pipeline (in-app + Discord DM).
 * @param dedupService - Guards against a double abort re-notifying.
 * @param lineup - The aborted lineup.
 * @param reason - Operator-supplied reason, or null.
 * @param actorDisplayName - Who aborted the lineup.
 * @param member - Recipient (invitee or creator).
 */
export async function sendLineupAbortedDM(
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupInfo,
  reason: string | null,
  actorDisplayName: string,
  member: DiscordMember,
): Promise<void> {
  const key = `lineup-aborted-dm:${lineup.id}:${member.userId}`;
  if (await dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;
  const titleSuffix = lineup.title ? ` — ${lineup.title}` : '';

  await notificationService.create({
    userId: member.userId,
    type: 'community_lineup',
    title: `Lineup aborted${titleSuffix}`,
    message: abortedDmMessage(reason, actorDisplayName),
    payload: {
      subtype: 'lineup_aborted',
      lineupId: lineup.id,
    },
  });
}

/**
 * Fan-out abort DMs to a private lineup's invitees + creator (ROK-1528).
 *
 * Same audience helper (`findInviteeDiscordMembers`) every other private
 * lifecycle notification uses, so nobody who heard the lineup was created
 * misses the news that it died.
 *
 * @param db - Drizzle handle used to resolve the invitee audience.
 * @param notificationService - Delivery pipeline.
 * @param dedupService - Per-recipient dedup guard.
 * @param lineup - The aborted lineup.
 * @param reason - Operator-supplied reason, or null.
 * @param actorDisplayName - Who aborted the lineup.
 */
export async function fanOutAbortedDMsToInvitees(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupInfo,
  reason: string | null,
  actorDisplayName: string,
): Promise<void> {
  const members = await findInviteeDiscordMembers(db, lineup.id);
  for (const member of members) {
    await sendLineupAbortedDM(
      notificationService,
      dedupService,
      lineup,
      reason,
      actorDisplayName,
      member,
    );
  }
}
