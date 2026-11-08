/**
 * ROK-2139 — roster identity rules for the Forever Blizzard sync. Pure.
 *
 * LedgerLink stores the full Forever name ("Rok Androl"); the Blizzard roster
 * API returns the first name only ("Rok"). These rules pair the two by first
 * name when that is unambiguous, repair the GUID-less duplicates an earlier
 * sync inserted, and refuse a sync that would drop most of the GUID roster.
 */
import { normalizeName } from '../addon-import/addon-import.binding-name';
import type { ForeverGuildMember } from '../blizzard-forever-guild.helpers';
import type { ExistingRosterRow } from './blizzard-roster-sync.helpers';

/**
 * The roster identity key: normalised, lower-cased full name.
 * @param name - A stored or API character name.
 */
export function rosterNameKey(name: string): string {
  return normalizeName(name).toLowerCase();
}

/**
 * The first-name key: {@link rosterNameKey} up to the first space.
 * @param name - A stored or API character name.
 */
export function firstNameKey(name: string): string {
  const [first] = rosterNameKey(name).split(' ');
  return first ?? '';
}

function countByKey<T>(
  items: readonly T[],
  keyOf: (t: T) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const it of items)
    counts.set(keyOf(it), (counts.get(keyOf(it)) ?? 0) + 1);
  return counts;
}

/** Items whose key occurs exactly once, by key. */
function uniqueByKey<T>(
  items: readonly T[],
  keyOf: (t: T) => string,
): Map<string, T> {
  const counts = countByKey(items, keyOf);
  return new Map(
    items
      .filter((it) => counts.get(keyOf(it)) === 1)
      .map((it) => [keyOf(it), it]),
  );
}

const hasGuid = (r: ExistingRosterRow): boolean => r.guid !== null;

/** First-name lookup built once per sync. */
export interface FirstNameIndex {
  /** GUID rows whose first name is unique among the guild's GUID rows. */
  rows: Map<string, ExistingRosterRow>;
  /** How many API members share each first name. */
  rosterCounts: Map<string, number>;
}

/**
 * Build the first-name lookup.
 * @param existing - Stored members of the guild.
 * @param incoming - Mapped API roster members.
 */
export function buildFirstNameIndex(
  existing: readonly ExistingRosterRow[],
  incoming: readonly ForeverGuildMember[],
): FirstNameIndex {
  return {
    rows: uniqueByKey(existing.filter(hasGuid), (r) =>
      firstNameKey(r.characterName),
    ),
    rosterCounts: countByKey(incoming, (m) => firstNameKey(m.name)),
  };
}

/**
 * The GUID row a member pairs with by first name, only when the first name
 * is unique on BOTH sides; else undefined.
 * @param member - The API member.
 * @param index - From {@link buildFirstNameIndex}.
 */
export function firstNameHit(
  member: ForeverGuildMember,
  index: FirstNameIndex,
): ExistingRosterRow | undefined {
  const key = firstNameKey(member.name);
  if (index.rosterCounts.get(key) !== 1) return undefined;
  return index.rows.get(key);
}

/** A GUID-less sync row folded into its GUID twin. */
export interface JunkMerge {
  junkId: number;
  targetId: number;
  blizzardCharacterId: number;
}

type JunkRow = ExistingRosterRow & { blizzardCharacterId: number };
const isJunk = (r: ExistingRosterRow): r is JunkRow =>
  r.guid === null && r.blizzardCharacterId !== null;

/** The GUID twin of one junk row: same Blizzard id, else unique first name. */
function junkTarget(
  junk: JunkRow,
  guidRows: readonly ExistingRosterRow[],
  junkCounts: Map<string, number>,
): ExistingRosterRow | undefined {
  const byId = guidRows.find(
    (r) => r.blizzardCharacterId === junk.blizzardCharacterId,
  );
  if (byId !== undefined) return byId;
  const key = firstNameKey(junk.characterName);
  if (junkCounts.get(key) !== 1) return undefined;
  const hit = uniqueByKey(guidRows, (r) => firstNameKey(r.characterName)).get(
    key,
  );
  return hit?.blizzardCharacterId === null ? hit : undefined;
}

/**
 * Pair each GUID-less row an earlier sync inserted (no GUID, a Blizzard id)
 * with the GUID row of the same character. Each target is used once.
 * Idempotent: once merged, no junk row is left to plan.
 * @param existing - Stored members of the guild.
 */
export function planJunkMerges(
  existing: readonly ExistingRosterRow[],
): JunkMerge[] {
  const guidRows = existing.filter(hasGuid);
  const junk = existing.filter(isJunk);
  const junkCounts = countByKey(junk, (r) => firstNameKey(r.characterName));
  const used = new Set<number>();
  const out: JunkMerge[] = [];
  for (const j of junk) {
    const target = junkTarget(j, guidRows, junkCounts);
    if (target === undefined || used.has(target.id)) continue;
    used.add(target.id);
    out.push({
      junkId: j.id,
      targetId: target.id,
      blizzardCharacterId: j.blizzardCharacterId,
    });
  }
  return out;
}

/**
 * The stored rows as they will be once the merges are written: junk rows
 * gone, targets carrying the Blizzard id.
 * @param existing - Stored members of the guild.
 * @param merges - From {@link planJunkMerges}.
 */
export function withMergesApplied(
  existing: readonly ExistingRosterRow[],
  merges: readonly JunkMerge[],
): ExistingRosterRow[] {
  const junkIds = new Set(merges.map((m) => m.junkId));
  const ids = new Map(merges.map((m) => [m.targetId, m.blizzardCharacterId]));
  return existing
    .filter((r) => !junkIds.has(r.id))
    .map((r) => {
      const blizzardCharacterId = ids.get(r.id);
      return blizzardCharacterId === undefined
        ? r
        : { ...r, blizzardCharacterId };
    });
}

const seenMs = (r: ExistingRosterRow): number =>
  r.lastSeenAt === null ? -Infinity : r.lastSeenAt.getTime();

/** GUID rows of the newest snapshot that stamped any GUID row. */
function latestGuidBatch(
  existing: readonly ExistingRosterRow[],
): ExistingRosterRow[] {
  const rows = existing.filter((r) => hasGuid(r) && r.lastSeenAt !== null);
  const newest = Math.max(...rows.map(seenMs));
  return rows.filter((r) => seenMs(r) === newest);
}

/**
 * Safety guard: the reason to refuse a sync that pairs fewer than half of the
 * guild's current GUID roster, or null when the sync may write.
 * @param existing - Stored members (after {@link withMergesApplied}).
 * @param matchedIds - Stored ids the sync matched.
 */
export function identityMismatch(
  existing: readonly ExistingRosterRow[],
  matchedIds: ReadonlySet<number>,
): string | null {
  const ref = latestGuidBatch(existing);
  if (ref.length === 0) return null;
  const hits = ref.filter((r) => matchedIds.has(r.id)).length;
  if (hits * 2 >= ref.length) return null;
  return `The Blizzard roster matched only ${hits} of ${ref.length} LedgerLink members, so nothing was written. Check the Blizzard guild slug, or re-import the roster from LedgerLink.`;
}
