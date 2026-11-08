/**
 * ROK-2137 — the in-game reported MOTD / Guild Information columns on
 * `guild_profiles` (written by `applyGuildGameText`; no access logic here).
 * Stamps read as microsecond UTC text, like ROK-2136's tokens.
 */
import { and, eq, isNotNull, sql, type AnyColumn } from 'drizzle-orm';
import type { IngameTextFieldKey } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import type { GameTextRow } from './guild-ingame-game-text.helpers';
import { utcText, type Db } from './guild-ingame-text.queries';

const { guildProfiles: profiles } = schema;

/** True when the report was pushed over: `ack IS NOT NULL AND reported <= ack`. */
const acked = (reported: AnyColumn, ack: AnyColumn) =>
  sql<boolean>`coalesce(${reported} <= ${ack}, false)`;

/** The two reported fields; null when the guild has no profile row. */
export async function findGameText(
  db: Db,
  guildId: number,
): Promise<GameTextRow | null> {
  const [row] = await db
    .select({
      motd: profiles.gameMotd,
      motdReportedAt: utcText(profiles.gameMotdReportedAt),
      motdAcked: acked(
        profiles.gameMotdReportedAt,
        profiles.gameMotdAcknowledgedAt,
      ),
      info: profiles.gameInfo,
      infoReportedAt: utcText(profiles.gameInfoReportedAt),
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
 * Push: `acknowledged_at = reported_at` for the field (the hub text stays).
 * Using the report's own stamp, not now(), means any NEWER report re-raises
 * the banner. False when the field was never reported (nothing to push over).
 */
export async function acknowledgeGameText(
  db: Db,
  guildId: number,
  field: IngameTextFieldKey,
): Promise<boolean> {
  const set =
    field === 'motd'
      ? { gameMotdAcknowledgedAt: sql`${profiles.gameMotdReportedAt}` }
      : { gameInfoAcknowledgedAt: sql`${profiles.gameInfoReportedAt}` };
  const reported =
    field === 'motd'
      ? profiles.gameMotdReportedAt
      : profiles.gameInfoReportedAt;
  const rows = await db
    .update(profiles)
    .set(set)
    .where(and(eq(profiles.guildId, guildId), isNotNull(reported)))
    .returning({ guildId: profiles.guildId });
  return rows.length > 0;
}
