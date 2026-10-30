/**
 * ROK-1914 L3 — the optional `withLockouts: true` half of the DEMO_MODE
 * `POST /admin/test/wow/seed-guild` fixture: one LedgerLink `char` snapshot
 * per linked character, carrying the instance lockouts the "Who's saved" hub
 * widget groups:
 *   - Molten Core (40 Player): the GM 10/10 and the officer 4/10 — one live
 *     save on two characters;
 *   - Onyxia's Lair (40 Player): the member 1/1 — a solo live save;
 *   - Blackwing Lair (40 Player): the GM, reset already passed — expired, so
 *     it must never show.
 *
 * Reset times are relative to the seed's `now` (live: +3 days, expired:
 * -1 day), and the snapshot is upserted on `(character, section)`, so a
 * re-seed of the same guild name restores fresh lockouts (the controller then
 * invalidates the guild's roster-insights cache). Talents are empty, so no
 * role-hint fact changes the other Forever widgets; gear is empty unless the
 * seed also sent `withGear` (ROK-1915, `demo-test-guild-gear.helpers.ts`),
 * which rides in this same row (unique `(character, section)`). `withGear`
 * alone writes empty lockout lists.
 */
import { createHash } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  ADDON_CHAR_SNAPSHOT_SCHEMA,
  type AddonCharSnapshotData,
  type AddonLockout,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { seedGearFor, type SeedGear } from './demo-test-guild-gear.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export type SeedLockoutOwner = 'gm' | 'officer' | 'member';

const DAY_S = 86_400;
const RAID_40 = 9;

export const SEED_LOCKOUT_SHARED = { name: 'Molten Core', instanceId: 409 };
export const SEED_LOCKOUT_SOLO = { name: "Onyxia's Lair", instanceId: 249 };
export const SEED_LOCKOUT_EXPIRED = { name: 'Blackwing Lair', instanceId: 469 };

export interface SeededGuildLockouts {
  /** Unix seconds of every live save's reset. */
  liveResetAt: number;
  /** Characters that received a snapshot. */
  characterIds: string[];
}

function lockout(
  base: { name: string; instanceId: number },
  resetAt: number,
  killed: number,
  total: number,
): AddonLockout {
  return { ...base, difficultyId: RAID_40, resetAt, killed, total };
}

/** Each linked owner's lockouts, relative to `nowS`. */
export function seedLockoutsFor(
  owner: SeedLockoutOwner,
  nowS: number,
): AddonLockout[] {
  const live = nowS + 3 * DAY_S;
  if (owner === 'gm') {
    return [
      lockout(SEED_LOCKOUT_SHARED, live, 10, 10),
      lockout(SEED_LOCKOUT_EXPIRED, nowS - DAY_S, 2, 8),
    ];
  }
  if (owner === 'officer') return [lockout(SEED_LOCKOUT_SHARED, live, 4, 10)];
  return [lockout(SEED_LOCKOUT_SOLO, live, 1, 1)];
}

/** Which halves of the snapshot to fill. */
export interface SeedSnapshotParts {
  lockouts: boolean;
  gear: boolean;
}

const NO_GEAR: SeedGear = { gear: [], schema: ADDON_CHAR_SNAPSHOT_SCHEMA };

/** The snapshot columns an upsert writes (and rewrites on conflict). */
function snapshotRow(lockouts: AddonLockout[], gear: SeedGear, now: Date) {
  const data: AddonCharSnapshotData = {
    gear: gear.gear,
    talents: { nodes: [] },
    lockouts,
  };
  const payloadSha256 = createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex');
  return {
    data,
    schema: gear.schema,
    capturedAt: now,
    importedAt: now,
    payloadSha256,
  };
}

async function upsertSnapshot(
  db: Db,
  characterId: string,
  parts: { lockouts: AddonLockout[]; gear: SeedGear },
  now: Date,
): Promise<void> {
  const row = snapshotRow(parts.lockouts, parts.gear, now);
  await db
    .insert(schema.characterAddonSnapshots)
    .values({ characterId, section: 'char', ...row })
    .onConflictDoUpdate({
      target: [
        schema.characterAddonSnapshots.characterId,
        schema.characterAddonSnapshots.section,
      ],
      set: row,
    });
}

/** Writes (or restores) the lockout and/or gear snapshots for the linked characters. */
export async function seedGuildLockouts(
  db: Db,
  owners: ReadonlyArray<{ owner: SeedLockoutOwner; characterId: string }>,
  now: Date,
  want: SeedSnapshotParts,
): Promise<SeededGuildLockouts> {
  const nowS = Math.floor(now.getTime() / 1000);
  for (const { owner, characterId } of owners) {
    const parts = {
      lockouts: want.lockouts ? seedLockoutsFor(owner, nowS) : [],
      gear: want.gear ? seedGearFor(owner) : NO_GEAR,
    };
    await upsertSnapshot(db, characterId, parts, now);
  }
  return {
    liveResetAt: nowS + 3 * DAY_S,
    characterIds: owners.map((o) => o.characterId),
  };
}
