import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { AddonGuildMember } from '@raid-ledger/contract';
import { guildMembers } from '../../../drizzle/schema';
import { titleCaseClass } from './addon-import.binding-name';
import { adoptGuidlessMembers } from './addon-import-guild.adopt';
import {
  insertDings,
  levelUps,
  type PriorLevel,
} from './addon-import-guild.dings';
import type { AddonApplyContext } from './addon-import-apply.types';

/**
 * ROK-1724 §4.3 guild apply — the member rows. Extracted from
 * `addon-import-guild.apply.ts` (ROK-2138 L3) with the Blizzard-held rule:
 * a row the Blizzard roster sync matched (`blizzard_character_id IS NOT
 * NULL`, operator ruling 2026-11-08) keeps its stored level / class /
 * rank_index where it has one — the API is the primary source; LedgerLink
 * fills every null. Everything the API does not serve (note, presence, last
 * seen) follows the export; the rank name stays paired with the kept index.
 */

/** Member row values. `publicNote` is the opted-in note or null — never more. */
export function memberValues(
  m: AddonGuildMember,
  guildId: number,
  ctx: AddonApplyContext,
  seenAt: Date,
) {
  return {
    guildId,
    guid: m.guid,
    characterName: m.name,
    level: m.level,
    class: titleCaseClass(m.class),
    rankIndex: m.rankIndex,
    rankName: m.rank,
    publicNote: m.note ?? null,
    source: 'addon_import',
    lastSeenAt: seenAt,
    // ROK-1916 D2/D3: presence verbatim; the read path normalises.
    onlineAtExport: m.online,
    lastOnlineDays: m.lastOnlineDays ?? null,
    capturedByUserId: ctx.userId,
    updatedAt: new Date(),
  };
}

/** One row per GUID (the decoder rejects cross-page repeats; last wins here). */
export function dedupeMembers(members: AddonGuildMember[]): AddonGuildMember[] {
  return [...new Map(members.map((m) => [m.guid, m])).values()];
}

/** Columns the export always owns: `SET col = excluded.col`. */
const ADDON_OWNED_MEMBER_COLUMNS = [
  'character_name',
  'public_note',
  'source',
  'last_seen_at',
  'captured_by_user_id',
  'updated_at',
  // ROK-1916 D2: overwrite with excluded.* (NULL included) — clears stale days.
  'online_at_export',
  'last_online_days',
] as const;

const camel = (c: string) =>
  c.replace(/_(\w)/g, (_m, ch: string) => ch.toUpperCase());

const blizzardHeld = sql`${guildMembers.blizzardCharacterId} IS NOT NULL`;

/** ROK-2138 D11 — a Blizzard-held row's stored value if non-null, else the export's. */
function unlessBlizzardHeld(stored: AnyPgColumn, column: string): SQL {
  const excluded = sql.raw(`excluded.${column}`);
  return sql`CASE WHEN ${blizzardHeld} AND ${stored} IS NOT NULL THEN ${stored} ELSE ${excluded} END`;
}

/** The export's rank list: rank index → name, as its members carry it. */
export function rankNamesByIndex(
  members: readonly AddonGuildMember[],
): Map<number, string> {
  return new Map(members.map((m) => [m.rankIndex, m.rank]));
}

/** SQL: the export's name for the row's STORED rank_index, else NULL. */
function exportNameForStoredIndex(names: Map<number, string>): SQL {
  if (names.size === 0) return sql`NULL::text`;
  const arms = [...names].map(([i, n]) => sql`WHEN ${i}::int THEN ${n}::text`);
  return sql`CASE ${guildMembers.rankIndex} ${sql.join(arms, sql` `)} ELSE NULL END`;
}

/**
 * ROK-2138 — the rank name follows the rank_index the row keeps: where a
 * Blizzard-held row keeps its stored index, the name is the export's name
 * for THAT index, else the stored name, else the member's own; otherwise the
 * export's (`nextRankName` reads the pair together).
 */
function rankNameSet(names: Map<number, string>): SQL {
  const keepsIndex = sql`${blizzardHeld} AND ${guildMembers.rankIndex} IS NOT NULL`;
  const paired = sql`COALESCE(${exportNameForStoredIndex(names)}, ${guildMembers.rankName}, excluded.rank_name)`;
  return sql`CASE WHEN ${keepsIndex} THEN ${paired} ELSE excluded.rank_name END`;
}

/** The member upsert's conflict update for this export's members. */
export function memberConflictSet(
  members: readonly AddonGuildMember[],
): Record<string, SQL> {
  return {
    ...Object.fromEntries(
      ADDON_OWNED_MEMBER_COLUMNS.map((c) => [
        camel(c),
        sql.raw(`excluded.${c}`),
      ]),
    ),
    level: unlessBlizzardHeld(guildMembers.level, 'level'),
    class: unlessBlizzardHeld(guildMembers.class, 'class'),
    rankIndex: unlessBlizzardHeld(guildMembers.rankIndex, 'rank_index'),
    rankName: rankNameSet(rankNamesByIndex(members)),
  };
}

/** Upsert members by (guild_id, guid); returns how many were inserted. */
async function upsertMembers(
  ctx: AddonApplyContext,
  guildId: number,
  members: AddonGuildMember[],
  seenAt: Date,
): Promise<number> {
  const rows = members.map((m) => memberValues(m, guildId, ctx, seenAt));
  const result = await ctx.tx
    .insert(guildMembers)
    .values(rows)
    .onConflictDoUpdate({
      target: [guildMembers.guildId, guildMembers.guid],
      targetWhere: sql`${guildMembers.guid} IS NOT NULL`,
      set: memberConflictSet(members),
    })
    .returning({ inserted: sql<boolean>`(xmax = 0)` });
  return result.filter((r) => r.inserted).length;
}

/**
 * ROK-2138 D12 — prior levels of the rows whose level this import writes:
 * Blizzard-held rows are left out, so a rise the addon reports but does not
 * store logs no ding (the Blizzard sync logs its own).
 */
export async function loadAddonHeldPriorLevels(
  ctx: AddonApplyContext,
  guildId: number,
  guids: string[],
): Promise<PriorLevel[]> {
  if (guids.length === 0) return [];
  const rows = await ctx.tx
    .select({
      id: guildMembers.id,
      guid: guildMembers.guid,
      level: guildMembers.level,
    })
    .from(guildMembers)
    .where(
      and(
        eq(guildMembers.guildId, guildId),
        inArray(guildMembers.guid, guids),
        isNull(guildMembers.blizzardCharacterId),
      ),
    );
  return rows.flatMap((r) => (r.guid === null ? [] : [{ ...r, guid: r.guid }]));
}

/** ROK-1919: upsert members, logging any level rise against prior rows. */
export async function upsertMembersLoggingDings(
  ctx: AddonApplyContext,
  guildId: number,
  payload: { data: { members: AddonGuildMember[] } },
  seenAt: Date,
): Promise<number> {
  const members = dedupeMembers(payload.data.members);
  await adoptGuidlessMembers(ctx, guildId, members); // ROK-1928 §B3
  const guids = members.map((m) => m.guid);
  const prior = await loadAddonHeldPriorLevels(ctx, guildId, guids);
  const inserted = await upsertMembers(ctx, guildId, members, seenAt);
  await insertDings(ctx, guildId, levelUps(prior, members), seenAt);
  return inserted;
}
