/**
 * ROK-1853 L5 — DEMO_MODE containers fixture writes: the two viewer users
 * (owner + member, stable per worker slot), and one containers scan through
 * the REAL importer (`importContainers`) on a stored snapshot row, so the
 * chest keys are the ones a live scan would produce.
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import {
  containerPublicKey,
  importContainers,
} from './valheim-armory-containers.import';
import {
  CONTAINERS_DEMO_MESSAGE as MSG,
  DEMO_PRIVATE_CHEST,
  DEMO_SHARED_CHEST,
} from './valheim-armory-containers-demo-fixture';

type Db = PostgresJsDatabase<typeof schema>;
export type ContainersFixtureRole = 'owner' | 'member';

const SNAPSHOT_KEY = `demo-containers:${MSG.worldUid}`;

/** The fixture's chest keys — computed exactly as the importer stores them. */
export const DEMO_CHEST_KEYS = {
  privateChestKey: containerPublicKey(MSG.worldUid, DEMO_PRIVATE_CHEST),
  sharedChestKey: containerPublicKey(MSG.worldUid, DEMO_SHARED_CHEST),
};

/** Stable identity of a fixture viewer for `slot` (pre-onboarded member). */
export function containersFixtureIdentity(
  role: ContainersFixtureRole,
  slot: number,
): { discordId: string; username: string } {
  return {
    discordId: `valheim-materials-${role}-${slot}`,
    username: `vh-materials-${role}-${slot}`,
  };
}

/** Find-or-create (and re-activate) a fixture viewer; returns its user id. */
export async function upsertContainersFixtureUser(
  db: Db,
  role: ContainersFixtureRole,
  slot: number,
): Promise<number> {
  const U = schema.users;
  const now = new Date();
  const [row] = await db
    .insert(U)
    .values({
      ...containersFixtureIdentity(role, slot),
      role: 'member',
      onboardingCompletedAt: now,
    })
    .onConflictDoUpdate({
      target: U.discordId,
      set: { role: 'member', onboardingCompletedAt: now, deactivatedAt: null },
    })
    .returning({ id: U.id });
  if (!row) throw new Error(`containers fixture: no ${role} user`);
  return row.id;
}

function snapshotValues(serverId: number): schema.NewValheimLinkSnapshot {
  return {
    pelicanServerId: serverId,
    kind: MSG.kind,
    snapshotKey: SNAPSHOT_KEY,
    steamId: null,
    playerId: null,
    worldUid: MSG.worldUid,
    gameVersion: MSG.gameVersion,
    modVersion: MSG.modVersion,
    capturedAt: new Date(MSG.capturedAt),
    payload: MSG,
    status: 'imported',
    statusDetail: null,
  };
}

/**
 * Reset the fixture world's scan on `serverId` and re-import it through the
 * importer, on one transaction. The stored snapshot is upserted in place
 * (`imported`, so the drain never re-applies it).
 */
export async function importDemoContainers(
  db: Db,
  serverId: number,
): Promise<void> {
  const S = schema.valheimLinkSnapshots;
  const scans = schema.valheimContainerScans;
  await db.transaction(async (tx) => {
    await tx
      .delete(scans)
      .where(
        and(
          eq(scans.pelicanServerId, serverId),
          eq(scans.worldUid, MSG.worldUid),
        ),
      );
    const values = snapshotValues(serverId);
    const [snap] = await tx
      .insert(S)
      .values(values)
      .onConflictDoUpdate({
        target: [S.pelicanServerId, S.kind, S.snapshotKey],
        set: { ...values, receivedAt: new Date() },
      })
      .returning({ id: S.id, receivedAt: S.receivedAt });
    if (!snap) throw new Error('containers fixture: no snapshot row');
    const stored = {
      id: snap.id,
      pelicanServerId: serverId,
      kind: MSG.kind,
      steamId: null,
      playerId: null,
      worldUid: MSG.worldUid,
      receivedAt: snap.receivedAt.toISOString(),
      payload: MSG,
    };
    const ok = await importContainers(tx, stored, MSG);
    if (!ok) throw new Error('containers fixture: import skipped as stale');
  });
}
