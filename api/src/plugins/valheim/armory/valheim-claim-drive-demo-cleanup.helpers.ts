/**
 * ROK-1933 — DEMO_MODE cleanup for the claim-drive fixture. `reset-to-seed`
 * keeps users, so the fixture's users A and B (synthetic Discord ids) outlive
 * a smoke run; the next smoke group then picked one up as a demo user, a DM
 * 10013'd and the user was deactivated. This removes, for ONE worker: every
 * fixture user who is a member of the worker's hub, the characters on the
 * worker's server and its sighting Quick Play. The server + hub rows stay —
 * the fixture upserts them per worker, so they never multiply.
 */
import { and, eq, like, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { deleteUserTransaction } from '../../../users/users-delete.helpers';
import {
  CLAIM_DRIVE_USERNAME_PREFIXES,
  claimDrivePanelUuid,
} from './valheim-claim-drive-demo-seed.helpers';
import { clearClaimDriveSighting } from './valheim-claim-drive-demo-sighting.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** `POST /admin/test/valheim/claim-drive-cleanup` response. */
export interface ClaimDriveCleanup {
  deletedUserIds: number[];
}

/** The worker's fixture server id, or null when it was never seeded. */
async function findClaimDriveServerId(
  db: Db,
  worker: number,
): Promise<number | null> {
  const S = schema.pelicanServers;
  const [row] = await db
    .select({ id: S.id })
    .from(S)
    .where(eq(S.panelUuid, claimDrivePanelUuid(worker)))
    .limit(1);
  return row?.id ?? null;
}

/** Fixture-named users who are members of a hub on `serverId`. */
async function findClaimDriveUserIds(
  db: Db,
  serverId: number,
): Promise<number[]> {
  const U = schema.users;
  const M = schema.hubServerMembers;
  const G = schema.guilds;
  const rows = await db
    .selectDistinct({ id: U.id })
    .from(U)
    .innerJoin(M, eq(M.userId, U.id))
    .innerJoin(G, eq(G.id, M.guildId))
    .where(
      and(
        eq(G.pelicanServerId, serverId),
        or(
          ...CLAIM_DRIVE_USERNAME_PREFIXES.map((p) =>
            like(U.username, `${p}%`),
          ),
        ),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Delete what the claim-drive fixture made for `worker`. Users go through the
 * full user-delete path (FK wipe/reassign, claims released); anything they
 * authored that must survive is reassigned to `reassignToUserId`.
 */
export async function cleanupClaimDrive(
  db: Db,
  worker: number,
  reassignToUserId: number,
): Promise<ClaimDriveCleanup> {
  await clearClaimDriveSighting(db, worker);
  const serverId = await findClaimDriveServerId(db, worker);
  if (serverId === null) return { deletedUserIds: [] };
  const userIds = await findClaimDriveUserIds(db, serverId);
  const P = schema.valheimProfiles;
  await db.delete(P).where(eq(P.pelicanServerId, serverId));
  for (const id of userIds) {
    await deleteUserTransaction(db, id, reassignToUserId);
  }
  return { deletedUserIds: userIds };
}
