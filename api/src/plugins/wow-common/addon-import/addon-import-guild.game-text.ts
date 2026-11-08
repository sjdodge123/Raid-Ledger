/**
 * ROK-2137 (guild text sync P1) — store the in-game MOTD / Guild Information
 * a LedgerLink guild export REPORTS on `guild_profiles.game_*`. Never the
 * hub's own text (`ingame_*`, ROK-2136) and never a Push acknowledgement.
 *
 * - A key absent from the export = no opinion: its columns are not written.
 * - `''` (after the hub's normalisation, D4) is a real report → NULL text.
 * - Control characters the hub's save rejects are stripped (same rule), so
 *   Adopt can always store the reported text.
 * - Per field, the report moves (text, `*_reported_at`, `*_reported_by`) only
 *   when it is not older than the stored one AND its text differs (review r1):
 *   `*_reported_at` = when the in-game text last CHANGED, so a re-export of
 *   the same text never re-raises a pushed-over notice. A move always
 *   strictly advances the stamp and clears `*_acknowledged_at` (review r2).
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  stripIngameControlChars,
  type AddonGuildData,
} from '@raid-ledger/contract';
import { guildProfiles } from '../../../drizzle/schema';
import { normaliseForStorage } from '../guilds/guild-ingame-text.helpers';
import type { AddonApplyContext } from './addon-import-apply.types';

/** The `game_*` columns one report sets (only the fields it carries). */
export interface GameTextReport {
  gameMotd?: string | null;
  gameMotdReportedAt?: Date;
  gameMotdReportedBy?: string | null;
  gameInfo?: string | null;
  gameInfoReportedAt?: Date;
  gameInfoReportedBy?: string | null;
}

/** Reported text → what is stored: control chars stripped, then D4. */
export function normaliseReportedText(text: string): string | null {
  return normaliseForStorage(stripIngameControlChars(text));
}

/** Export `data` → the columns to write; `{}` when it reports neither box. */
export function gameTextReport(
  data: Pick<AddonGuildData, 'motd' | 'infoText'>,
  reportedAt: Date,
  reportedBy: string | null = null,
): GameTextReport {
  const by = reportedBy === null || reportedBy === '' ? null : reportedBy;
  return {
    ...(data.motd !== undefined
      ? {
          gameMotd: normaliseReportedText(data.motd),
          gameMotdReportedAt: reportedAt,
          gameMotdReportedBy: by,
        }
      : {}),
    ...(data.infoText !== undefined
      ? {
          gameInfo: normaliseReportedText(data.infoText),
          gameInfoReportedAt: reportedAt,
          gameInfoReportedBy: by,
        }
      : {}),
  };
}

type Field = 'Motd' | 'Info';
type GameTextColumn =
  | `game${Field}`
  | `game${Field}Reported${'At' | 'By'}`
  | `game${Field}AcknowledgedAt`;

const excluded = (column: GameTextColumn): SQL =>
  sql.raw(`excluded."${guildProfiles[column].name}"`);

/**
 * The report moves when nothing was reported yet, or when the stored report
 * is not newer AND the reported text changed. Compared against `excluded`,
 * never a bound JS Date (drizzle's postgres.js driver does not serialize a
 * Date inside raw `sql`).
 */
function reportMoves(field: Field): SQL {
  const stamp: GameTextColumn = `game${field}ReportedAt`;
  const text: GameTextColumn = `game${field}`;
  const stored = guildProfiles[stamp];
  return sql`${stored} IS NULL OR (${stored} <= ${excluded(stamp)} AND ${guildProfiles[text]} IS DISTINCT FROM ${excluded(text)})`;
}

/**
 * What a moving report writes into `column`. The stamp strictly advances
 * (review r2): two exports in the same snapshot second with different text
 * would otherwise keep the stamp, so a stale Adopt/Push would validate
 * against text the editor never saw. `GREATEST` skips a NULL stored stamp.
 * The acknowledgement clears, so a pushed-over notice re-raises.
 */
function movedValue(column: GameTextColumn, field: Field): SQL {
  const stamp: GameTextColumn = `game${field}ReportedAt`;
  if (column === stamp) {
    return sql`GREATEST(${excluded(stamp)}, ${guildProfiles[stamp]} + interval '1 millisecond')`;
  }
  const ack: GameTextColumn = `game${field}AcknowledgedAt`;
  if (column === ack) return sql`NULL`;
  return excluded(column);
}

/** `column` takes the moving report's value, else keeps the stored one. */
export function changedNotOlder(column: GameTextColumn, field: Field): SQL {
  return sql`CASE WHEN ${reportMoves(field)} THEN ${movedValue(column, field)} ELSE ${guildProfiles[column]} END`;
}

function fieldSet(field: Field): Record<string, SQL> {
  const columns: GameTextColumn[] = [
    `game${field}`,
    `game${field}ReportedAt`,
    `game${field}ReportedBy`,
    `game${field}AcknowledgedAt`,
  ];
  return Object.fromEntries(columns.map((c) => [c, changedNotOlder(c, field)]));
}

/** The conflict `set` for the fields this report carries. */
export function conflictSet(report: GameTextReport): Record<string, SQL> {
  return {
    ...('gameMotdReportedAt' in report ? fieldSet('Motd') : {}),
    ...('gameInfoReportedAt' in report ? fieldSet('Info') : {}),
  };
}

/**
 * Upsert the reported in-game text onto the guild's profile row. No-op (no
 * row created) when the export carries neither key. `reportedAt` is the
 * snapshot's received instant (`receivedSnapshotAt`), the same stamp the
 * roster gets; `reportedBy` the exporter (`who.fullName`). Needs only
 * `ctx.tx` (the DEMO_MODE `seed-guild-game-text` fixture calls it too).
 */
export async function applyGuildGameText(
  ctx: Pick<AddonApplyContext, 'tx'>,
  guildId: number,
  data: Pick<AddonGuildData, 'motd' | 'infoText'>,
  reportedAt: Date,
  reportedBy: string | null = null,
): Promise<void> {
  const report = gameTextReport(data, reportedAt, reportedBy);
  if (Object.keys(report).length === 0) return;
  await ctx.tx
    .insert(guildProfiles)
    .values({ guildId, ...report })
    .onConflictDoUpdate({
      target: guildProfiles.guildId,
      set: conflictSet(report),
    });
}
