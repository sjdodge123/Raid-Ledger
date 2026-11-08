/**
 * ROK-2139 — roster identity rules for the Forever Blizzard sync. Pure.
 *
 * LedgerLink stores the full Forever name ("Rok Androl"); the Blizzard roster
 * API returns the first name only ("Rok"). These rules pair the two by first
 * name when that is unambiguous, repair the GUID-less duplicates an earlier
 * sync inserted, and refuse a sync that would replace the GUID roster.
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

const seenMs = (r: ExistingRosterRow): number =>
  r.lastSeenAt === null ? -Infinity : r.lastSeenAt.getTime();

/**
 * GUID rows of the newest snapshot that stamped any GUID row — the members
 * LedgerLink (or the last sync) saw as current. Departed members' rows are
 * older, so a first name never binds a newcomer to them (ROK-2139 M1).
 * @param existing - Stored members of the guild.
 */
export function latestGuidBatch(
  existing: readonly ExistingRosterRow[],
): ExistingRosterRow[] {
  const rows = existing.filter((r) => hasGuid(r) && r.lastSeenAt !== null);
  const newest = Math.max(...rows.map(seenMs));
  return rows.filter((r) => seenMs(r) === newest);
}

/**
 * {@link latestGuidBatch}, or nothing when that batch is not in the guild's
 * latest snapshot — every member a snapshot keeps is stamped with its time
 * (`inLatestSnapshot`: `last_seen_at >= guilds.last_snapshot_at`), so a GUID
 * batch older than the newest stamped row has departed (ROK-2139 Codex P2).
 * @param existing - Stored members of the guild.
 */
export function currentGuidBatch(
  existing: readonly ExistingRosterRow[],
): ExistingRosterRow[] {
  const batch = latestGuidBatch(existing);
  const newest = Math.max(...existing.map(seenMs));
  return batch.filter((r) => seenMs(r) === newest);
}

/**
 * True unless both classes are known and differ (case-insensitive).
 * @param a - A stored or mapped class name, or null.
 * @param b - Another class name, or null.
 */
export function sameClass(a: string | null, b: string | null): boolean {
  return a === null || b === null || a.toLowerCase() === b.toLowerCase();
}

/** First-name lookup built once per sync. */
export interface FirstNameIndex {
  /** Current GUID rows whose first name is unique among the current batch. */
  rows: Map<string, ExistingRosterRow>;
  /** How many API members share each first name. */
  rosterCounts: Map<string, number>;
}

/**
 * Build the first-name lookup over the newest GUID batch only.
 * @param existing - Stored members of the guild.
 * @param incoming - Mapped API roster members.
 */
export function buildFirstNameIndex(
  existing: readonly ExistingRosterRow[],
  incoming: readonly ForeverGuildMember[],
): FirstNameIndex {
  return {
    rows: uniqueByKey(latestGuidBatch(existing), (r) =>
      firstNameKey(r.characterName),
    ),
    rosterCounts: countByKey(incoming, (m) => firstNameKey(m.name)),
  };
}

/**
 * The current GUID row a member pairs with by first name, only when the
 * first name is unique on BOTH sides; else undefined. The caller checks class.
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

/** The candidate twins of the junk rows of one sync. */
interface JunkTwins {
  /** Every GUID row (a Blizzard-id twin may be any of them). */
  guidRows: readonly ExistingRosterRow[];
  /** Current GUID rows by unique first name (ROK-2139 M1). */
  byFirst: Map<string, ExistingRosterRow>;
  /** How many junk rows share each first name. */
  junkCounts: Map<string, number>;
  /** The incoming roster by Blizzard id (ROK-2139 Codex P1). */
  liveById: Map<number, ForeverGuildMember>;
  /** How many incoming members share each first name. */
  rosterCounts: Map<string, number>;
}

/**
 * True when the incoming roster still lists the junk row's Blizzard id under
 * the same first name, and that first name once only — so the member the
 * matcher pairs with the twin is this id, never another (Codex P1).
 */
function junkIdIsLive(junk: JunkRow, key: string, twins: JunkTwins): boolean {
  const live = twins.liveById.get(junk.blizzardCharacterId);
  if (live === undefined || firstNameKey(live.name) !== key) return false;
  return twins.rosterCounts.get(key) === 1;
}

/**
 * The GUID twin of one junk row: same Blizzard id, else a unique first name
 * in the newest GUID batch with a compatible class and no Blizzard id —
 * only while the incoming roster still lists the junk row's id under that
 * first name ({@link junkIdIsLive}).
 */
function junkTarget(
  junk: JunkRow,
  twins: JunkTwins,
): ExistingRosterRow | undefined {
  const byId = twins.guidRows.find(
    (r) => r.blizzardCharacterId === junk.blizzardCharacterId,
  );
  if (byId !== undefined) return byId;
  const key = firstNameKey(junk.characterName);
  if (twins.junkCounts.get(key) !== 1) return undefined;
  if (!junkIdIsLive(junk, key, twins)) return undefined;
  const hit = twins.byFirst.get(key);
  if (hit === undefined || hit.blizzardCharacterId !== null) return undefined;
  return sameClass(hit.className, junk.className) ? hit : undefined;
}

function liveMembersById(
  incoming: readonly ForeverGuildMember[],
): Map<number, ForeverGuildMember> {
  const byId = new Map<number, ForeverGuildMember>();
  for (const m of incoming)
    if (m.blizzardId !== null) byId.set(m.blizzardId, m);
  return byId;
}

/**
 * Pair each GUID-less row an earlier sync inserted (no GUID, a Blizzard id)
 * with the GUID row of the same character. Each target is used once.
 * Idempotent: once merged, no junk row is left to plan.
 * @param existing - Stored members of the guild.
 * @param incoming - Mapped API roster members of this sync.
 */
export function planJunkMerges(
  existing: readonly ExistingRosterRow[],
  incoming: readonly ForeverGuildMember[],
): JunkMerge[] {
  const junk = existing.filter(isJunk);
  const twins: JunkTwins = {
    guidRows: existing.filter(hasGuid),
    byFirst: uniqueByKey(latestGuidBatch(existing), (r) =>
      firstNameKey(r.characterName),
    ),
    junkCounts: countByKey(junk, (r) => firstNameKey(r.characterName)),
    liveById: liveMembersById(incoming),
    rosterCounts: countByKey(incoming, (m) => firstNameKey(m.name)),
  };
  const used = new Set<number>();
  const out: JunkMerge[] = [];
  for (const j of junk) {
    const target = junkTarget(j, twins);
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

/** The higher known level of a merged pair — the newer observation. */
function newerLevel(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  return b === null ? a : Math.max(a, b);
}

/**
 * The stored rows as they will be once the merges are written: junk rows
 * gone, targets carrying the Blizzard id and the higher level of the pair,
 * so a ding is logged from the newer level (ROK-2139 Codex P3).
 * @param existing - Stored members of the guild.
 * @param merges - From {@link planJunkMerges}.
 */
export function withMergesApplied(
  existing: readonly ExistingRosterRow[],
  merges: readonly JunkMerge[],
): ExistingRosterRow[] {
  const rowById = new Map(existing.map((r) => [r.id, r]));
  const byTarget = new Map(merges.map((m) => [m.targetId, m]));
  const junkIds = new Set(merges.map((m) => m.junkId));
  return existing
    .filter((r) => !junkIds.has(r.id))
    .map((r) => {
      const merge = byTarget.get(r.id);
      if (merge === undefined) return r;
      const junkLevel = rowById.get(merge.junkId)?.level ?? null;
      return {
        ...r,
        blizzardCharacterId: merge.blizzardCharacterId,
        level: newerLevel(r.level, junkLevel),
      };
    });
}

/**
 * Safety guard: the reason to refuse a sync that REPLACES the GUID roster
 * (few current GUID rows matched while as many members arrived unmatched),
 * or null when no GUID batch is current ({@link currentGuidBatch}),
 * or null when the sync may write. A shrink is allowed: the candidates are
 * the members that matched a current GUID row or matched nothing, and the
 * sync is refused only when `hits * 2 < min(current GUID rows, candidates)`.
 * @param existing - Stored members (after {@link withMergesApplied}).
 * @param matchedIds - Stored ids the sync matched.
 * @param unmatched - How many API members matched no stored row.
 */
export function identityMismatch(
  existing: readonly ExistingRosterRow[],
  matchedIds: ReadonlySet<number>,
  unmatched: number,
): string | null {
  const ref = currentGuidBatch(existing);
  if (ref.length === 0) return null;
  const hits = ref.filter((r) => matchedIds.has(r.id)).length;
  if (hits * 2 >= Math.min(ref.length, hits + unmatched)) return null;
  return `The Blizzard roster matched only ${hits} of ${ref.length} LedgerLink members, so nothing was written. Check the Blizzard guild slug, or re-import the roster from LedgerLink.`;
}
