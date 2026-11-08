/**
 * ROK-2137 (guild text sync P1) — store the in-game MOTD / Guild Information
 * a LedgerLink guild export REPORTS on `guild_profiles.game_*`. Never the
 * hub's own text (`ingame_*`, ROK-2136) and never a Push acknowledgement.
 *
 * - A key absent from the export = no opinion: its columns are not written.
 * - `''` (after the hub's normalisation, D4) is a real report → NULL text
 *   with a fresh `*_reported_at`.
 * - Per field, a report older than the stored one is ignored (atomic CASE
 *   against `excluded`, so the timestamp never moves backwards).
 */
import { sql, type SQL } from 'drizzle-orm';
import type { AddonGuildData } from '@raid-ledger/contract';
import { guildProfiles } from '../../../drizzle/schema';
import { normaliseForStorage } from '../guilds/guild-ingame-text.helpers';
import type { AddonApplyContext } from './addon-import-apply.types';

/** The `game_*` columns one report sets (only the fields it carries). */
export interface GameTextReport {
  gameMotd?: string | null;
  gameMotdReportedAt?: Date;
  gameInfo?: string | null;
  gameInfoReportedAt?: Date;
}

/** Export `data` → the columns to write; `{}` when it reports neither box. */
export function gameTextReport(
  data: Pick<AddonGuildData, 'motd' | 'infoText'>,
  reportedAt: Date,
): GameTextReport {
  return {
    ...(data.motd !== undefined
      ? {
          gameMotd: normaliseForStorage(data.motd),
          gameMotdReportedAt: reportedAt,
        }
      : {}),
    ...(data.infoText !== undefined
      ? {
          gameInfo: normaliseForStorage(data.infoText),
          gameInfoReportedAt: reportedAt,
        }
      : {}),
  };
}

type GameTextColumn = keyof Pick<
  typeof guildProfiles,
  'gameMotd' | 'gameMotdReportedAt' | 'gameInfo' | 'gameInfoReportedAt'
>;

/**
 * `column` takes the incoming value unless the stored report (`stamp`) is
 * newer. Compared against `excluded`, never a bound JS Date (drizzle's
 * postgres.js driver does not serialize a Date inside raw `sql`).
 */
function newerWins(column: GameTextColumn, stamp: GameTextColumn): SQL {
  const stored = guildProfiles[stamp];
  const incoming = sql.raw(`excluded."${guildProfiles[stamp].name}"`);
  const next = sql.raw(`excluded."${guildProfiles[column].name}"`);
  return sql`CASE WHEN ${stored} IS NULL OR ${stored} <= ${incoming} THEN ${next} ELSE ${guildProfiles[column]} END`;
}

/** The conflict `set` for the fields this report carries. */
function conflictSet(report: GameTextReport): Record<string, SQL> {
  const motd = 'gameMotdReportedAt';
  const info = 'gameInfoReportedAt';
  return {
    ...(motd in report
      ? { gameMotd: newerWins('gameMotd', motd), [motd]: newerWins(motd, motd) }
      : {}),
    ...(info in report
      ? { gameInfo: newerWins('gameInfo', info), [info]: newerWins(info, info) }
      : {}),
  };
}

/**
 * Upsert the reported in-game text onto the guild's profile row. No-op (no
 * row created) when the export carries neither key. `reportedAt` is the
 * snapshot's received instant (`receivedSnapshotAt`), the same stamp the
 * roster gets. Needs only `ctx.tx` (the DEMO_MODE
 * `seed-guild-game-text` fixture calls it outside an import).
 */
export async function applyGuildGameText(
  ctx: Pick<AddonApplyContext, 'tx'>,
  guildId: number,
  data: Pick<AddonGuildData, 'motd' | 'infoText'>,
  reportedAt: Date,
): Promise<void> {
  const report = gameTextReport(data, reportedAt);
  if (Object.keys(report).length === 0) return;
  await ctx.tx
    .insert(guildProfiles)
    .values({ guildId, ...report })
    .onConflictDoUpdate({
      target: guildProfiles.guildId,
      set: conflictSet(report),
    });
}
