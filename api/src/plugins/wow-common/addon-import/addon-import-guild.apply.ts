import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type {
  AddonGuildExport,
  AddonGuildImportSummarySchema,
  AddonGuildMember,
} from '@raid-ledger/contract';
import type { z } from 'zod';
import { guildMembers, guilds } from '../../../drizzle/schema';
import { titleCaseClass } from './addon-import.binding-name';
import { AddonImportError } from './addon-import.errors';
import {
  fromUnix,
  guildNameKey,
  type AddonApplyContext,
  type AddonSectionOutcome,
} from './addon-import-apply.types';

/**
 * ROK-1724 §4.3 Apply — section `guild`. Shared, self-reported rows: one
 * realm-less guild per (game, region, lower(name)) and its members by GUID.
 * Members missing from a snapshot are kept (soft removal via last_seen_at).
 * There is no officer-note column; only the opted-in public `note` lands.
 */

export type AddonGuildSummary = z.infer<typeof AddonGuildImportSummarySchema>;
type GuildOutcome = AddonSectionOutcome<AddonGuildSummary>;

/** The exporter must appear in the roster they export. */
export function assertExporterInGuild(payload: AddonGuildExport): void {
  const guid = payload.who.guid;
  if (!payload.data.members.some((m) => m.guid === guid)) {
    throw new AddonImportError('NOT_IN_GUILD');
  }
}

/** A snapshot older than the stored one is stale (equal is not). */
export function isStaleGuildSnapshot(
  lastSnapshotAt: Date | null | undefined,
  snapshotAt: number,
): boolean {
  if (!lastSnapshotAt) return false;
  return fromUnix(snapshotAt).getTime() < lastSnapshotAt.getTime();
}

export function buildGuildSummary(
  payload: AddonGuildExport,
  pages: number,
  newMembers: number,
): AddonGuildSummary {
  const members = payload.data.members.length;
  return {
    guildName: payload.data.name,
    members,
    newMembers,
    updatedMembers: members - newMembers,
    pages,
  };
}

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
    capturedByUserId: ctx.userId,
    updatedAt: new Date(),
  };
}

const realmless = (ctx: AddonApplyContext, key: string) =>
  and(
    eq(guilds.gameId, ctx.gameId),
    eq(guilds.region, ctx.region),
    eq(guilds.nameKey, key),
    isNull(guilds.realmSlug),
  );

async function loadGuild(ctx: AddonApplyContext, name: string) {
  const [row] = await ctx.tx
    .select({ id: guilds.id, lastSnapshotAt: guilds.lastSnapshotAt })
    .from(guilds)
    .where(realmless(ctx, guildNameKey(name)));
  return row;
}

async function countKnownMembers(
  ctx: AddonApplyContext,
  guildId: number,
  guids: string[],
): Promise<number> {
  if (guids.length === 0) return 0;
  const rows = await ctx.tx
    .select({ guid: guildMembers.guid })
    .from(guildMembers)
    .where(
      and(eq(guildMembers.guildId, guildId), inArray(guildMembers.guid, guids)),
    );
  return rows.length;
}

/** Dry run: NOT_IN_GUILD / stale checks + new-vs-updated counts; no writes. */
export async function previewGuild(
  ctx: AddonApplyContext,
  payload: AddonGuildExport,
  pages: number,
): Promise<GuildOutcome> {
  assertExporterInGuild(payload);
  const guild = await loadGuild(ctx, payload.data.name);
  const guids = payload.data.members.map((m) => m.guid);
  const known = guild ? await countKnownMembers(ctx, guild.id, guids) : 0;
  const summary = buildGuildSummary(payload, pages, guids.length - known);
  if (isStaleGuildSnapshot(guild?.lastSnapshotAt, payload.data.snapshotAt)) {
    return { status: 'stale', summary };
  }
  return { status: 'preview', summary };
}

/** One row per GUID (the decoder rejects cross-page repeats; last wins here). */
export function dedupeMembers(members: AddonGuildMember[]): AddonGuildMember[] {
  return [...new Map(members.map((m) => [m.guid, m])).values()];
}

/**
 * Upsert the realm-less guild — only when this snapshot is not older than
 * the stored one (`setWhere`, atomic). No row back = stale, nothing written.
 */
/** Guild columns an addon snapshot owns (insert + conflict update). */
export function guildSet(payload: AddonGuildExport) {
  return {
    name: payload.data.name,
    memberCount: payload.data.members.length,
    lastSnapshotAt: fromUnix(payload.data.snapshotAt),
    rawRealm: payload.data.rawRealm ?? null,
    faction: payload.who.faction,
    updatedAt: new Date(),
  };
}

async function upsertGuild(
  ctx: AddonApplyContext,
  payload: AddonGuildExport,
): Promise<number | undefined> {
  const set = guildSet(payload);
  const [row] = await ctx.tx
    .insert(guilds)
    .values({
      ...set,
      gameId: ctx.gameId,
      region: ctx.region,
      nameKey: guildNameKey(payload.data.name),
      source: 'addon_import',
    })
    .onConflictDoUpdate({
      target: [guilds.gameId, guilds.region, guilds.nameKey],
      targetWhere: sql`${guilds.realmSlug} IS NULL`,
      set,
      // Compare against `excluded`, never a bound JS Date: drizzle's
      // postgres.js driver does not serialize a Date inside raw `sql`
      // (ERR_INVALID_ARG_TYPE → 500).
      setWhere: sql`(${guilds.lastSnapshotAt} IS NULL OR ${guilds.lastSnapshotAt} <= excluded.last_snapshot_at)`,
    })
    .returning({ id: guilds.id });
  return row?.id;
}

const EXCLUDED_MEMBER_COLUMNS = [
  'character_name',
  'level',
  'class',
  'rank_index',
  'rank_name',
  'public_note',
  'source',
  'last_seen_at',
  'captured_by_user_id',
  'updated_at',
] as const;

const camel = (c: string) =>
  c.replace(/_(\w)/g, (_m, ch: string) => ch.toUpperCase());

/** `SET col = excluded.col` for every mutable member column. */
const memberConflictSet = Object.fromEntries(
  EXCLUDED_MEMBER_COLUMNS.map((c) => [camel(c), sql.raw(`excluded.${c}`)]),
);

/** Upsert members by (guild_id, guid); returns how many were inserted. */
async function upsertMembers(
  ctx: AddonApplyContext,
  guildId: number,
  payload: AddonGuildExport,
): Promise<number> {
  const seenAt = fromUnix(payload.data.snapshotAt);
  const rows = dedupeMembers(payload.data.members).map((m) =>
    memberValues(m, guildId, ctx, seenAt),
  );
  const result = await ctx.tx
    .insert(guildMembers)
    .values(rows)
    .onConflictDoUpdate({
      target: [guildMembers.guildId, guildMembers.guid],
      targetWhere: sql`${guildMembers.guid} IS NOT NULL`,
      set: memberConflictSet,
    })
    .returning({ inserted: sql<boolean>`(xmax = 0)` });
  return result.filter((r) => r.inserted).length;
}

/** Apply: NOT_IN_GUILD → reject; stale → nothing written; else upsert all. */
export async function applyGuild(
  ctx: AddonApplyContext,
  payload: AddonGuildExport,
  pages: number,
): Promise<GuildOutcome> {
  assertExporterInGuild(payload);
  const guildId = await upsertGuild(ctx, payload);
  if (guildId === undefined) {
    const stale = await previewGuild(ctx, payload, pages);
    return { status: 'stale', summary: stale.summary };
  }
  const inserted = await upsertMembers(ctx, guildId, payload);
  return {
    status: 'applied',
    summary: buildGuildSummary(payload, pages, inserted),
  };
}
