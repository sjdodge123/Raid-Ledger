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
 * re-seed of the same guild name restores fresh lockouts. Gear and talents
 * are empty, so no ilvl or role-hint fact changes the other Forever widgets.
 */
import { createHash } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  AddonCharSnapshotData,
  AddonLockout,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

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

async function upsertSnapshot(
  db: Db,
  characterId: string,
  lockouts: AddonLockout[],
  now: Date,
): Promise<void> {
  const data: AddonCharSnapshotData = {
    gear: [],
    talents: { nodes: [] },
    lockouts,
  };
  const payloadSha256 = createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex');
  const row = { data, capturedAt: now, importedAt: now, payloadSha256 };
  await db
    .insert(schema.characterAddonSnapshots)
    .values({ characterId, section: 'char', schema: 2, ...row })
    .onConflictDoUpdate({
      target: [
        schema.characterAddonSnapshots.characterId,
        schema.characterAddonSnapshots.section,
      ],
      set: row,
    });
}

/** Writes (or restores) the lockout snapshots for the linked characters. */
export async function seedGuildLockouts(
  db: Db,
  owners: ReadonlyArray<{ owner: SeedLockoutOwner; characterId: string }>,
  now: Date,
): Promise<SeededGuildLockouts> {
  const nowS = Math.floor(now.getTime() / 1000);
  for (const { owner, characterId } of owners) {
    await upsertSnapshot(db, characterId, seedLockoutsFor(owner, nowS), now);
  }
  return {
    liveResetAt: nowS + 3 * DAY_S,
    characterIds: owners.map((o) => o.characterId),
  };
}
