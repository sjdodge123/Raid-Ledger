import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import type {
  NewValheimProfileClaimEvent,
  ValheimProfileClaimEventRow,
} from '../../../../drizzle/schema';
import type { ValheimLinkTx } from '../../link/valheim-link-token-lock';

type Db = PostgresJsDatabase<typeof schema>;
type Exec = Db | ValheimLinkTx;
const { valheimProfiles: profiles, valheimProfileClaimEvents: events } = schema;

/** Rows from a `RETURNING` raw statement (postgres.js RowList is an array). */
function rowsOf<T>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : [];
}

/**
 * ROK-1835 L3 data access for claims. Every Steam match compares the
 * mod-asserted `valheim_profiles.steam_id` ONLY against `users.steam_id`,
 * which is written solely by Raid Ledger's own Steam OpenID link flow
 * (trust boundary R5) — and only for active users (`deactivated_at IS NULL`).
 * Every claim write is a single conditional statement (D6, D7).
 */
@Injectable()
export class ValheimIdentityRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** Run `fn` in one transaction. */
  transaction<T>(fn: (tx: ValheimLinkTx) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  /**
   * Serialise every Steam auto-match write for `steamId64` (import attach,
   * link attach, unlink detach) until `exec`'s transaction ends. Statements
   * after it see whatever an unlink committed first (READ COMMITTED), so a
   * stale attach cannot follow a detach that already ran.
   */
  async lockSteamIdentity(exec: Exec, steamId64: string): Promise<void> {
    await exec.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('valheim-identity:' || ${steamId64}))`,
    );
  }

  /** A1: attach an UNCLAIMED profile to its verified Steam user; the user id or null. */
  async autoAttachProfile(
    exec: Exec,
    profileId: number,
  ): Promise<number | null> {
    // Match against users.steam_id only (set by RL's Steam auth, R5).
    const res = await exec.execute(sql`
      UPDATE valheim_profiles p
         SET claimed_by = u.id, claim_source = 'auto', claimed_at = now()
        FROM users u
       WHERE p.id = ${profileId} AND p.claimed_by IS NULL
         AND u.steam_id = p.steam_id AND u.deactivated_at IS NULL
   RETURNING p.claimed_by AS "userId"`);
    return rowsOf<{ userId: number }>(res)[0]?.userId ?? null;
  }

  /** A2: attach every unclaimed profile asserting `steamId64` to the (active) user who just linked it. */
  async attachBySteamId(
    exec: Exec,
    userId: number,
    steamId64: string,
  ): Promise<number[]> {
    // Re-checks users.steam_id (RL Steam auth, R5) so a stale event is inert.
    const res = await exec.execute(sql`
      UPDATE valheim_profiles p
         SET claimed_by = u.id, claim_source = 'auto', claimed_at = now()
        FROM users u
       WHERE u.id = ${userId} AND u.steam_id = ${steamId64}
         AND u.deactivated_at IS NULL
         AND p.steam_id = ${steamId64} AND p.claimed_by IS NULL
   RETURNING p.id AS "id"`);
    return rowsOf<{ id: number }>(res).map((r) => r.id);
  }

  /** A3: detach the user's `auto` claims for `steamId64`; manual/admin stay. */
  async detachAutoBySteamId(
    exec: Exec,
    userId: number,
    steamId64: string,
  ): Promise<number[]> {
    const rows = await exec
      .update(profiles)
      .set({ claimedBy: null, claimSource: null, claimedAt: null })
      .where(
        and(
          eq(profiles.claimedBy, userId),
          eq(profiles.claimSource, 'auto'),
          eq(profiles.steamId, steamId64),
        ),
      )
      .returning({ id: profiles.id });
    return rows.map((r) => r.id);
  }

  /** Member claim: first claim wins (`WHERE claimed_by IS NULL`). */
  async claimIfUnclaimed(
    exec: Exec,
    profileId: number,
    userId: number,
  ): Promise<boolean> {
    const rows = await exec
      .update(profiles)
      .set({ claimedBy: userId, claimSource: 'manual', claimedAt: new Date() })
      .where(and(eq(profiles.id, profileId), isNull(profiles.claimedBy)))
      .returning({ id: profiles.id });
    return rows.length > 0;
  }

  /** Lock the profile row (`FOR UPDATE`) and read its owner; null = no profile. */
  async lockOwner(
    exec: Exec,
    profileId: number,
  ): Promise<{ claimedBy: number | null } | null> {
    const [row] = await exec
      .select({ claimedBy: profiles.claimedBy })
      .from(profiles)
      .where(eq(profiles.id, profileId))
      .for('update');
    return row ?? null;
  }

  /** Admin owner write: `admin` source, or clear both columns for null. */
  async setOwner(
    exec: Exec,
    profileId: number,
    userId: number | null,
  ): Promise<void> {
    await exec
      .update(profiles)
      .set(
        userId === null
          ? { claimedBy: null, claimSource: null, claimedAt: null }
          : { claimedBy: userId, claimSource: 'admin', claimedAt: new Date() },
      )
      .where(eq(profiles.id, profileId));
  }

  /** True when the profile row exists. */
  async profileExists(
    profileId: number,
    exec: Exec = this.db,
  ): Promise<boolean> {
    const rows = await exec
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, profileId));
    return rows.length > 0;
  }

  /** True when the user exists and is not deactivated. */
  async isActiveUser(exec: Exec, userId: number): Promise<boolean> {
    const rows = await exec
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(eq(schema.users.id, userId), isNull(schema.users.deactivatedAt)),
      );
    return rows.length > 0;
  }

  /** Insert audit rows; returns them as stored. */
  async insertEvents(
    exec: Exec,
    rows: NewValheimProfileClaimEvent[],
  ): Promise<ValheimProfileClaimEventRow[]> {
    if (rows.length === 0) return [];
    return exec.insert(events).values(rows).returning();
  }

  /** A profile's audit trail, newest first. */
  listEvents(
    profileId: number,
    limit = 100,
  ): Promise<ValheimProfileClaimEventRow[]> {
    return this.db
      .select()
      .from(events)
      .where(eq(events.profileId, profileId))
      .orderBy(desc(events.createdAt), desc(events.id))
      .limit(limit);
  }
}
