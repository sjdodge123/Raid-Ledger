import { and, eq } from 'drizzle-orm';
import type { AddonGuildMember } from '@raid-ledger/contract';
import { guildMembers } from '../../../drizzle/schema';
import { normalizeName } from './addon-import.binding-name';
import type { AddonApplyContext } from './addon-import-apply.types';

/**
 * ROK-1928 §B3 — a Blizzard roster sync inserts GUID-less rows (`source
 * 'blizzard'`). The addon upsert keys on GUID, so without this step a later
 * addon import would INSERT a second row for the same character. Before the
 * upsert, each incoming GUID that this guild does not know yet adopts the
 * GUID-less row of the same lower(name) (newest `last_seen_at` first).
 */

/**
 * Review r2 NIT — the ONE rule for "may this incoming GUID adopt a GUID-less
 * row": only when no stored row of the guild (live or not) has it. Shared by
 * {@link pickAdoptions} and the roster guard so their counts cannot drift.
 */
export function isAdoptableGuid(
  stored: ReadonlySet<string>,
  guid: string,
): boolean {
  return !stored.has(guid);
}

/** Every GUID a guild stores (live or not). */
export async function storedGuids(
  tx: AddonApplyContext['tx'],
  guildId: number,
): Promise<Set<string>> {
  const rows = await tx
    .select({ guid: guildMembers.guid })
    .from(guildMembers)
    .where(eq(guildMembers.guildId, guildId));
  return new Set(rows.flatMap((r) => (r.guid === null ? [] : [r.guid])));
}

/** The stored columns adoption reads. */
export interface AdoptableRow {
  id: number;
  guid: string | null;
  characterName: string;
  lastSeenAt: Date | null;
}

/** One GUID to write onto a GUID-less row. */
export interface Adoption {
  id: number;
  guid: string;
}

/** The name key adoption matches on: normalized, lower-cased. */
export const adoptionKey = (name: string): string =>
  normalizeName(name).toLowerCase();
const key = adoptionKey;
const seenMs = (r: AdoptableRow): number =>
  r.lastSeenAt === null ? -Infinity : r.lastSeenAt.getTime();

/** GUID-less rows grouped by name key, newest `last_seen_at` first. */
function guidlessByName(rows: readonly AdoptableRow[]) {
  const byName = new Map<string, AdoptableRow[]>();
  for (const r of rows.filter((x) => x.guid === null)) {
    byName.set(key(r.characterName), [
      ...(byName.get(key(r.characterName)) ?? []),
      r,
    ]);
  }
  for (const g of byName.values()) g.sort((a, b) => seenMs(b) - seenMs(a));
  return byName;
}

/**
 * Pure: which GUID-less rows adopt which incoming GUID. A GUID the guild
 * already stores is never adopted (the upsert updates that row); each row
 * adopts at most one GUID.
 * @param rows - Every stored member row of the guild.
 * @param members - The deduped addon roster.
 */
export function pickAdoptions(
  rows: readonly AdoptableRow[],
  members: readonly Pick<AddonGuildMember, 'guid' | 'name'>[],
): Adoption[] {
  const known = new Set(rows.flatMap((r) => (r.guid === null ? [] : [r.guid])));
  const byName = guidlessByName(rows);
  const out: Adoption[] = [];
  for (const m of members) {
    if (!isAdoptableGuid(known, m.guid)) continue;
    const row = byName.get(key(m.name))?.shift();
    if (row === undefined) continue;
    known.add(m.guid);
    out.push({ id: row.id, guid: m.guid });
  }
  return out;
}

/**
 * Write the adoptions inside the import transaction (it already holds the
 * guild-import lock), before the member upsert.
 * @param ctx - Apply context (its `tx`).
 * @param guildId - The guild being imported.
 * @param members - The deduped addon roster.
 */
export async function adoptGuidlessMembers(
  ctx: Pick<AddonApplyContext, 'tx'>,
  guildId: number,
  members: readonly AddonGuildMember[],
): Promise<number> {
  const rows = await ctx.tx
    .select({
      id: guildMembers.id,
      guid: guildMembers.guid,
      characterName: guildMembers.characterName,
      lastSeenAt: guildMembers.lastSeenAt,
    })
    .from(guildMembers)
    .where(eq(guildMembers.guildId, guildId));
  const adoptions = pickAdoptions(rows, members);
  for (const a of adoptions) {
    await ctx.tx
      .update(guildMembers)
      .set({ guid: a.guid, updatedAt: new Date() })
      .where(and(eq(guildMembers.id, a.id), eq(guildMembers.guildId, guildId)));
  }
  return adoptions.length;
}

/** GUID-less live rows split by whether an incoming new member adopts them. */
export interface GuidlessMatch<T> {
  kept: T[];
  gone: T[];
}

/**
 * Pure (ROK-1928 review MAJOR): which GUID-less live rows the coming
 * adoption keeps. Each incoming name key keeps at most one row.
 * @param rows - Live GUID-less rows.
 * @param freshKeys - Name keys ({@link adoptionKey}) of incoming GUIDs the guild does not know.
 */
export function matchGuidlessRows<T extends { name: string }>(
  rows: readonly T[],
  freshKeys: readonly string[],
): GuidlessMatch<T> {
  const left = new Map<string, number>();
  for (const k of freshKeys) left.set(k, (left.get(k) ?? 0) + 1);
  const out: GuidlessMatch<T> = { kept: [], gone: [] };
  for (const r of rows) {
    const n = left.get(adoptionKey(r.name)) ?? 0;
    if (n > 0) left.set(adoptionKey(r.name), n - 1);
    (n > 0 ? out.kept : out.gone).push(r);
  }
  return out;
}
