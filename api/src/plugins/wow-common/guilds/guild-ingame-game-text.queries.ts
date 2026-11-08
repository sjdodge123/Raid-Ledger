/**
 * ROK-2137 — the in-game reported MOTD / Guild Information columns on
 * `guild_profiles` (written by `applyGuildGameText`; no access logic here).
 * Stamps read as microsecond UTC text, like ROK-2136's tokens.
 */
import { and, eq, isNotNull, sql, type AnyColumn } from 'drizzle-orm';
import type { IngameTextFieldKey } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import type { GameTextRow } from './guild-ingame-game-text.helpers';
import { utcText, type Db, type Tx } from './guild-ingame-text.queries';

const { guildProfiles: profiles } = schema;

/** True when the report was pushed over: `ack IS NOT NULL AND reported <= ack`. */
const acked = (reported: AnyColumn, ack: AnyColumn) =>
  sql<boolean>`coalesce(${reported} <= ${ack}, false)`;

/**
 * The two reported fields; null when the guild has no profile row. Adopt
 * reads it with the save's `tx`, under `lockIngameText`'s row lock (review r2).
 */
export async function findGameText(
  db: Db | Tx,
  guildId: number,
): Promise<GameTextRow | null> {
  const [row] = await db
    .select({
      motd: profiles.gameMotd,
      motdReportedAt: utcText(profiles.gameMotdReportedAt),
      motdReportedBy: profiles.gameMotdReportedBy,
      motdAcked: acked(
        profiles.gameMotdReportedAt,
        profiles.gameMotdAcknowledgedAt,
      ),
      info: profiles.gameInfo,
      infoReportedAt: utcText(profiles.gameInfoReportedAt),
      infoReportedBy: profiles.gameInfoReportedBy,
      infoAcked: acked(
        profiles.gameInfoReportedAt,
        profiles.gameInfoAcknowledgedAt,
      ),
    })
    .from(profiles)
    .where(eq(profiles.guildId, guildId));
  return row ?? null;
}

/**
 * Push: `acknowledged_at = reported_at` for the field (the hub text stays),
 * only while the stored report is still the one the editor saw (`seenAt`,
 * compared at ms precision). Using the report's own stamp, not now(), means
 * a report whose text changes later re-raises the banner. False when the
 * field was never reported or the report moved on.
 */
export async function acknowledgeGameText(
  db: Db,
  guildId: number,
  field: IngameTextFieldKey,
  seenAt: string,
): Promise<boolean> {
  const reported =
    field === 'motd'
      ? profiles.gameMotdReportedAt
      : profiles.gameInfoReportedAt;
  const set =
    field === 'motd'
      ? { gameMotdAcknowledgedAt: sql`${reported}` }
      : { gameInfoAcknowledgedAt: sql`${reported}` };
  const rows = await db
    .update(profiles)
    .set(set)
    .where(
      and(
        eq(profiles.guildId, guildId),
        isNotNull(reported),
        sql`date_trunc('milliseconds', ${reported}) = date_trunc('milliseconds', ${seenAt}::timestamptz)`,
      ),
    )
    .returning({ guildId: profiles.guildId });
  return rows.length > 0;
}
