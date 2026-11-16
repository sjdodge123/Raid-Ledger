import { sql, type SQL } from 'drizzle-orm';
import * as schema from '../../../../drizzle/schema';
import {
  FOREVER_NAME_SQL_PATTERN,
  isForeverTwoPartName,
} from '../../forever-character-slug';

/**
 * ROK-2222 — which roster rows are a claimable identity. Blizzard's Forever
 * guild roster API returns FIRST names only; when a player's first name is
 * ambiguous the sync keeps a GUID-less row such as "Rok" that carries the
 * real character's Blizzard id. Claiming it created a character that can
 * never refresh (no realmless Armory route for one word) and that holds the
 * real character's id, so autolink hit `external_id_conflict` forever.
 *
 * A row carrying a LedgerLink GUID stays claimable whatever its name: the GUID
 * pin lets the next LedgerLink import reconcile the character.
 */

const { guildMembers } = schema;

/** 400 text for a refused first-name-only roster row. */
export const FIRST_NAME_ONLY =
  'This roster entry has only a first name — import the character with LedgerLink';

/** The roster-row fields the rule reads. */
export interface RosterIdentity {
  name: string;
  guid: string | null;
}

/**
 * True when the row may be claimed: it carries a GUID, or its name is a
 * two-part Forever name (the `isForeverTwoPartName` rule).
 */
export function isClaimableRosterIdentity(row: RosterIdentity): boolean {
  return row.guid !== null || isForeverTwoPartName(row.name);
}

/**
 * SQL twin of {@link isClaimableRosterIdentity} over `guild_members`, using the
 * shared locale-free prefilter `FOREVER_NAME_SQL_PATTERN` (a superset of the
 * JS rule; the claim re-checks with the JS rule).
 */
export function hasClaimableRosterIdentity(): SQL {
  return sql`(${guildMembers.guid} is not null or btrim(${guildMembers.characterName}) ~ ${FOREVER_NAME_SQL_PATTERN})`;
}
