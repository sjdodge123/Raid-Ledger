/**
 * ROK-2133: the one Blizzard fetch behind a roster member's Armory snapshot
 * (D2). Same calls an Armory import makes for a realmless Forever character
 * minus completed quests (Q2). Never throws for a Blizzard failure — the
 * error is classified so the caller can back off. Verifying the fetched id
 * against the roster's (`id_mismatch`) is the caller's step, via
 * `isSnapshotVerified`.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';
import type { CharacterSyncAdapter } from '../../plugin-host/extension-points';
import {
  fetchFullProfile,
  type EnrichedProfile,
} from '../../../characters/characters-sync.helpers';
import { resolveNsPrefix } from '../../../characters/characters-crud.helpers';
import { isForeverTwoPartName } from '../forever-character-slug';
import { classifyAutoLinkError } from '../forever-auto-link/forever-auto-link.helpers';
import type {
  MemberArmoryErrorKind,
  MemberArmorySnapshot,
} from './snapshot.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Who to fetch: the roster member's stored name, region and Forever game. */
export interface SnapshotFetchTarget {
  name: string;
  region: string;
  gameId: number;
  /** Stamped as `syncedAt` on success; defaults to the current time. */
  now?: Date;
}

/** A fetched snapshot, or why the attempt failed. */
export type SnapshotFetchResult =
  | { ok: true; snapshot: MemberArmorySnapshot }
  | { ok: false; kind: MemberArmoryErrorKind };

/**
 * Fetch a Forever roster member's Armory profile (quests skipped). A name
 * the realmless route cannot address is `invalid_name` with no Blizzard
 * call; a 404 is `not_found`; anything else thrown is `upstream`.
 */
export async function fetchForeverArmorySnapshot(
  db: Db,
  adapter: CharacterSyncAdapter,
  target: SnapshotFetchTarget,
): Promise<SnapshotFetchResult> {
  if (!isForeverTwoPartName(target.name)) {
    return { ok: false, kind: 'invalid_name' };
  }
  const nsPrefix = await resolveNsPrefix(db, target.gameId);
  let fetched: EnrichedProfile;
  try {
    fetched = await fetchFullProfile(
      adapter,
      target.name,
      null,
      target.region,
      nsPrefix,
      { quests: false },
    );
  } catch (err) {
    return { ok: false, kind: classifyAutoLinkError(err) };
  }
  const syncedAt = target.now ?? new Date();
  return { ok: true, snapshot: profileToSnapshot(fetched, syncedAt) };
}

/**
 * Map a fetched profile onto the snapshot columns. The profile route does
 * not surface a last-login time today, so `lastLoginAt` stays null.
 */
export function profileToSnapshot(
  fetched: EnrichedProfile,
  syncedAt: Date,
): MemberArmorySnapshot {
  const { profile } = fetched;
  return {
    blizzardCharacterId: parseBlizzardId(profile.externalId),
    level: profile.level,
    class: profile.class,
    race: profile.race,
    spec: profile.spec,
    role: profile.role,
    itemLevel: profile.itemLevel,
    avatarUrl: profile.avatarUrl,
    equipment: fetched.equipment,
    talents: fetched.talents,
    armoryProfessions: fetched.professions,
    lastLoginAt: null,
    syncedAt,
  };
}

/** A fetched id string as a safe integer, else null (never stored as-is). */
function parseBlizzardId(externalId: string | null | undefined): number | null {
  if (externalId === null || externalId === undefined) return null;
  if (!/^\d+$/.test(externalId)) return null;
  const id = Number(externalId);
  return Number.isSafeInteger(id) ? id : null;
}
