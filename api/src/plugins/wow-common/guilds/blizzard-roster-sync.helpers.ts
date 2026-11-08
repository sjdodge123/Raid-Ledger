/**
 * ROK-1928 B1 — pure rules for the Forever guild roster sync. No Nest, no
 * Drizzle: the sync service (B2) loads rows, calls these, and writes.
 *
 * The roster body is UNVERIFIED (B-0, synthetic fixture); identity is the
 * character `name` (B-1). The API returns the first name only, LedgerLink the
 * full "Name Surname", so a unique first name also pairs (ROK-2139).
 */
import { titleCaseClass } from '../addon-import/addon-import.binding-name';
import type {
  ForeverGuildMember,
  ForeverGuildRoster,
} from '../blizzard-forever-guild.helpers';
import {
  buildFirstNameIndex,
  firstNameHit,
  rosterNameKey,
  sameClass,
  type FirstNameIndex,
} from './blizzard-roster-sync.identity';

/**
 * Classic class ids → the client class token (B-2). Run through
 * `titleCaseClass` so Blizzard rows store exactly what addon rows store.
 */
const FOREVER_CLASS_TOKEN_BY_ID: Readonly<Record<number, string>> = {
  1: 'WARRIOR',
  2: 'PALADIN',
  3: 'HUNTER',
  4: 'ROGUE',
  5: 'PRIEST',
  7: 'SHAMAN',
  8: 'MAGE',
  9: 'WARLOCK',
  11: 'DRUID',
};

/** The stored `guild_members` columns the matcher and patch read. */
export interface ExistingRosterRow {
  id: number;
  guid: string | null;
  blizzardCharacterId: number | null;
  characterName: string;
  /** Stored `class` (title case), or null when unknown (ROK-2139 M1). */
  className: string | null;
  level: number | null;
  rankIndex: number | null;
  rankName: string | null;
  lastSeenAt: Date | null;
}

/** Result of pairing API members with stored rows. */
export interface RosterMatchResult {
  matched: { existingId: number; member: ForeverGuildMember }[];
  unmatched: ForeverGuildMember[];
  warnings: string[];
}

/** The only `guild_members` columns a Blizzard sync may update (§B2 step 6). */
export interface RosterUpdatePatch {
  level: number;
  class?: string;
  rankIndex: number;
  rankName: string | null;
  blizzardCharacterId?: number;
  lastSeenAt: Date;
  updatedAt: Date;
}

/**
 * Title-case class name for a Forever `playable_class.id`, or null when the
 * id is missing or unknown (the stored class is then left untouched).
 * @param id - `playable_class.id` from the roster body.
 */
export function classNameForForeverId(id: number | null): string | null {
  if (id === null) return null;
  const token = FOREVER_CLASS_TOKEN_BY_ID[id];
  return token === undefined ? null : titleCaseClass(token);
}

/** The roster identity key: normalised, lower-cased name. */
const nameKey = rosterNameKey;

function seenAtMs(row: ExistingRosterRow): number {
  return row.lastSeenAt === null ? -Infinity : row.lastSeenAt.getTime();
}

/** Group rows by name key, newest `last_seen_at` first. */
function indexByName(
  rows: readonly ExistingRosterRow[],
): Map<string, ExistingRosterRow[]> {
  const byName = new Map<string, ExistingRosterRow[]>();
  for (const row of rows) {
    const key = nameKey(row.characterName);
    byName.set(key, [...(byName.get(key) ?? []), row]);
  }
  for (const group of byName.values()) {
    group.sort((a, b) => seenAtMs(b) - seenAtMs(a));
  }
  return byName;
}

function indexByBlizzardId(
  rows: readonly ExistingRosterRow[],
): Map<number, ExistingRosterRow> {
  const byId = new Map<number, ExistingRosterRow>();
  for (const row of rows) {
    if (row.blizzardCharacterId !== null) {
      byId.set(row.blizzardCharacterId, row);
    }
  }
  return byId;
}

/** A name match must not steal a row already bound to another Blizzard id. */
function nameMatchable(
  row: ExistingRosterRow,
  member: ForeverGuildMember,
): boolean {
  return (
    row.blizzardCharacterId === null ||
    row.blizzardCharacterId === member.blizzardId
  );
}

function duplicateWarning(key: string, rows: ExistingRosterRow[]): string {
  const [kept, ...rest] = rows;
  const ignored = rest.map((r) => r.id).join(', ');
  return `Forever roster: ${rows.length} rows share name "${key}"; updating row ${kept?.id ?? '?'} (newest last_seen_at), ignoring ${ignored}`;
}

/** The lookups one sync builds over the stored rows. */
interface RosterIndexes {
  byId: Map<number, ExistingRosterRow>;
  byName: Map<string, ExistingRosterRow[]>;
  byFirst: FirstNameIndex;
}

/**
 * First-name fallback (ROK-2139): a current GUID row, unique on both sides,
 * not bound elsewhere, and of the same class when both classes are known.
 */
function firstNameFallback(
  member: ForeverGuildMember,
  idx: RosterIndexes,
): ExistingRosterRow | undefined {
  const hit = firstNameHit(member, idx.byFirst);
  if (hit === undefined || !nameMatchable(hit, member)) return undefined;
  const memberClass = classNameForForeverId(member.classId);
  return sameClass(hit.className, memberClass) ? hit : undefined;
}

/**
 * The stored row a member pairs with — Blizzard id, then exact full name,
 * then unique first name — plus the name group it came from.
 */
function findHit(
  member: ForeverGuildMember,
  idx: RosterIndexes,
): { hit: ExistingRosterRow | undefined; dupes: ExistingRosterRow[] } {
  const idHit =
    member.blizzardId === null ? undefined : idx.byId.get(member.blizzardId);
  if (idHit !== undefined) return { hit: idHit, dupes: [] };
  const group = (idx.byName.get(nameKey(member.name)) ?? []).filter((r) =>
    nameMatchable(r, member),
  );
  if (group.length === 0) {
    return { hit: firstNameFallback(member, idx), dupes: [] };
  }
  return { hit: group[0], dupes: group.length > 1 ? group : [] };
}

/**
 * Pair API members with stored rows: by `blizzard_character_id` first, else
 * by lower(name), else by a first name unique among the GUID rows AND the
 * roster (ROK-2139). When several rows share a name the newest
 * `last_seen_at` wins and a warning is returned (B-5). A row is matched at
 * most once.
 * @param existing - Stored members of the guild.
 * @param incoming - Mapped API roster members.
 */
export function matchRosterMembers(
  existing: readonly ExistingRosterRow[],
  incoming: readonly ForeverGuildMember[],
): RosterMatchResult {
  const idx: RosterIndexes = {
    byId: indexByBlizzardId(existing),
    byName: indexByName(existing),
    byFirst: buildFirstNameIndex(existing, incoming),
  };
  const used = new Set<number>();
  const result: RosterMatchResult = {
    matched: [],
    unmatched: [],
    warnings: [],
  };
  for (const member of incoming) {
    const { hit, dupes } = findHit(member, idx);
    if (hit === undefined || used.has(hit.id)) {
      result.unmatched.push(member);
      continue;
    }
    if (dupes.length > 0) {
      result.warnings.push(duplicateWarning(nameKey(member.name), dupes));
    }
    used.add(hit.id);
    result.matched.push({ existingId: hit.id, member });
  }
  return result;
}

/**
 * Rank name after a sync (B-3): the API gives a rank index only, so the
 * stored name survives only while the index is unchanged; else null.
 * @param prevRankIndex - Stored rank index (null on insert).
 * @param prevRankName - Stored rank name.
 * @param nextRankIndex - Rank index from the API.
 */
export function nextRankName(
  prevRankIndex: number | null,
  prevRankName: string | null,
  nextRankIndex: number,
): string | null {
  return prevRankIndex === nextRankIndex ? prevRankName : null;
}

/**
 * The UPDATE for a matched row. Never touches `guid`, `public_note`,
 * `online_at_export`, `last_online_days`, `captured_by_user_id` or `source`;
 * class and Blizzard id only when the API gives one.
 * @param existing - The stored row.
 * @param member - The API member it matched.
 * @param now - Sync instant T.
 */
export function rosterUpdatePatch(
  existing: Pick<ExistingRosterRow, 'rankIndex' | 'rankName'>,
  member: ForeverGuildMember,
  now: Date,
): RosterUpdatePatch {
  const className = classNameForForeverId(member.classId);
  return {
    level: member.level,
    ...(className === null ? {} : { class: className }),
    rankIndex: member.rank,
    rankName: nextRankName(existing.rankIndex, existing.rankName, member.rank),
    ...(member.blizzardId === null
      ? {}
      : { blizzardCharacterId: member.blizzardId }),
    lastSeenAt: now,
    updatedAt: now,
  };
}

/**
 * True when a 200 roster has no members (B-4 → `skipped_empty`): applying it
 * would demote the whole guild, so the sync writes nothing.
 * @param roster - Mapped API roster.
 */
export function isEmptyRoster(roster: ForeverGuildRoster): boolean {
  return roster.members.length === 0;
}
