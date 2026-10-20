/**
 * ROK-1853 D5 — the ONLY place the personal-chest rule lives. Every query
 * that can reach a `private` container ANDs `personalVisibleSql`; shared
 * queries use `sharedSql` and never see a private row.
 */
import { sql, type SQL } from 'drizzle-orm';
import * as schema from '../../../../drizzle/schema';
import type { AuthenticatedUser } from '../../../../auth/types';

const c = schema.valheimContainers;

/** Who is reading, reduced to what the predicate needs. */
export interface MaterialsViewer {
  id: number;
  /**
   * `users.role` is `admin` or `operator` (ROK-1858: operators see personal
   * chests like admins — operator ruling 2026-10-20) and NOT impersonated.
   */
  isAdmin: boolean;
  /** An impersonated session sees no personal chests at all. */
  impersonated: boolean;
}

/** The JWT user → viewer (an impersonating admin/operator is never `isAdmin`). */
export function toMaterialsViewer(user: AuthenticatedUser): MaterialsViewer {
  const impersonated = user.impersonatedBy !== null;
  return {
    id: user.id,
    isAdmin:
      (user.role === 'admin' || user.role === 'operator') && !impersonated,
    impersonated,
  };
}

/** Public and group chests — no viewer term (D5). */
export const sharedSql: SQL = sql`${c.privacy} <> 'private'`;

/**
 * Private chests this viewer may see: admins and operators all of them; an impersonated
 * session none; otherwise only chests whose creator is a character the
 * viewer has claimed on THAT server — auto/admin claims, or a manual claim
 * whose Steam id is the viewer's own verified one — and never a playerId
 * that appears under two Steam ids on the server (admins only, design §3.2).
 */
export function personalVisibleSql(viewer: MaterialsViewer): SQL {
  if (viewer.impersonated) return sql`false`;
  if (viewer.isAdmin) return sql`${c.privacy} = 'private'`;
  return claimedPrivateSql(viewer.id);
}

/**
 * The viewer's OWN private chests only, whatever their role — the recipe
 * planner's "Include my personal chests" (ROK-1854 review): an admin's plan
 * never nets against other members' private stock. Impersonated → none.
 */
export function ownPersonalSql(viewer: MaterialsViewer): SQL {
  if (viewer.impersonated) return sql`false`;
  return claimedPrivateSql(viewer.id);
}

/** Private chests whose creator is a character `viewerId` validly claims. */
function claimedPrivateSql(viewerId: number): SQL {
  return sql`(${c.privacy} = 'private' AND EXISTS (
    SELECT 1 FROM valheim_profiles p JOIN users u ON u.id = p.claimed_by
    WHERE p.pelican_server_id = ${c.pelicanServerId}
      AND p.player_id = ${c.creatorPlayerId}
      AND p.claimed_by = ${viewerId}
      AND (p.claim_source IN ('auto', 'admin')
           OR (p.claim_source = 'manual' AND u.steam_id = p.steam_id))
      AND NOT EXISTS (
        SELECT 1 FROM valheim_profiles q
        WHERE q.pelican_server_id = p.pelican_server_id
          AND q.player_id = p.player_id
          AND q.steam_id <> p.steam_id)))`;
}

/** Shared ∪ personal-visible — the list and detail routes. */
export function visibleSql(viewer: MaterialsViewer): SQL {
  return sql`(${sharedSql} OR ${personalVisibleSql(viewer)})`;
}

/** D10: `includeVehicles=false` drops carts and ships. */
export function vehicleSql(includeVehicles: boolean): SQL {
  return includeVehicles ? sql`true` : sql`NOT ${c.vehicle}`;
}
