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

const key = (name: string): string => normalizeName(name).toLowerCase();
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
    if (known.has(m.guid)) continue;
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
