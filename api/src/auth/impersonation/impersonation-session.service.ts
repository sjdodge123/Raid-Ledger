/**
 * ROK-1754 §3.4.2: server-side impersonation, keyed by refresh family.
 *
 * DB-only on purpose (no RefreshTokenService dependency) so the refresh layer
 * can call into it without a DI cycle: `/auth/refresh` →
 * `resolveForRefresh`, logout → `end(familyId,'logout')`, revokeFamily →
 * `end(familyId,'session_revoked')`, revokeAllForUser →
 * `endForUser(userId,'session_revoked')`, cleanup cron → `sweepExpired()`.
 * Every end audits ONE `impersonate_stop` row per deleted marker
 * (`DELETE … RETURNING`), so retries never double-audit.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, lte } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { RefreshFamilyImpersonation } from '../../drizzle/schema';
import { insertAdminAction } from '../../users/users-admin-actions.helpers';
import {
  auditMetadata,
  markerEndReason,
  markerExpiry,
  type ImpersonationEndReason,
} from './impersonation-session.helpers';

const markers = schema.refreshFamilyImpersonations;

export interface ImpersonationTarget {
  id: number;
  username: string;
  role: (typeof schema.users.$inferSelect)['role'];
}

@Injectable()
export class ImpersonationSessionService {
  private readonly logger = new Logger(ImpersonationSessionService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Upsert the family's marker (fresh 1h cap) and audit `impersonate_start`. */
  async start(
    familyId: string,
    adminId: number,
    targetId: number,
  ): Promise<RefreshFamilyImpersonation> {
    const now = new Date();
    const values = {
      familyId,
      impersonatorUserId: adminId,
      targetUserId: targetId,
      startedAt: now,
      expiresAt: markerExpiry(now),
    };
    const [row] = await this.db
      .insert(markers)
      .values(values)
      .onConflictDoUpdate({ target: markers.familyId, set: values })
      .returning();
    await this.auditStart(adminId, targetId, familyId);
    return row ?? values;
  }

  /** Audit a start; `familyId: null` = cookie-less, non-renewable token. */
  async auditStart(
    adminId: number,
    targetId: number,
    familyId: string | null,
  ): Promise<void> {
    await insertAdminAction(this.db, {
      action: 'impersonate_start',
      actorId: adminId,
      targetId,
      metadata: auditMetadata({ familyId, persistent: familyId !== null }),
    });
  }

  /** The family's marker if it has not passed `expires_at`, else null. */
  async findLiveByFamily(
    familyId: string,
  ): Promise<RefreshFamilyImpersonation | null> {
    const [row] = await this.db
      .select()
      .from(markers)
      .where(
        and(eq(markers.familyId, familyId), gt(markers.expiresAt, new Date())),
      )
      .limit(1);
    return row ?? null;
  }

  /** End one family's impersonation. True when a marker was deleted. */
  async end(
    familyId: string,
    reason: ImpersonationEndReason,
  ): Promise<boolean> {
    const rows = await this.db
      .delete(markers)
      .where(eq(markers.familyId, familyId))
      .returning();
    await this.auditStops(rows, reason);
    return rows.length > 0;
  }

  /** End every impersonation this user is running (all their families). */
  async endForUser(
    userId: number,
    reason: ImpersonationEndReason,
  ): Promise<number> {
    const rows = await this.db
      .delete(markers)
      .where(eq(markers.impersonatorUserId, userId))
      .returning();
    await this.auditStops(rows, reason);
    return rows.length;
  }

  /** Cron: delete markers at/after `expires_at`, one `expired` audit each. */
  async sweepExpired(): Promise<number> {
    const rows = await this.db
      .delete(markers)
      .where(lte(markers.expiresAt, new Date()))
      .returning();
    await this.auditStops(rows, 'expired');
    return rows.length;
  }

  /**
   * For `/auth/refresh` (lane A2): the target to mint while the marker is
   * live and valid (§3.4.2 rules); otherwise ends the marker and returns null.
   */
  async resolveForRefresh(
    familyId: string,
    refreshUserId: number,
  ): Promise<{ target: ImpersonationTarget; expiresAt: Date } | null> {
    const [marker] = await this.db
      .select()
      .from(markers)
      .where(eq(markers.familyId, familyId))
      .limit(1);
    if (!marker) return null;
    const impersonator = await this.loadUser(marker.impersonatorUserId);
    const target = await this.loadUser(marker.targetUserId);
    const reason = markerEndReason(
      marker,
      refreshUserId,
      impersonator,
      target,
      new Date(),
    );
    if (reason || !target) {
      await this.end(familyId, reason ?? 'target_promoted');
      return null;
    }
    const { id, username, role } = target;
    return { target: { id, username, role }, expiresAt: marker.expiresAt };
  }

  private async loadUser(id: number) {
    const [row] = await this.db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        role: schema.users.role,
        bannedAt: schema.users.bannedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);
    return row ?? null;
  }

  private async auditStops(
    rows: RefreshFamilyImpersonation[],
    reason: ImpersonationEndReason,
  ): Promise<void> {
    for (const row of rows) {
      this.logger.log(
        `IMPERSONATION END: admin id:${row.impersonatorUserId} -> id:${row.targetUserId} (${reason})`,
      );
      await insertAdminAction(this.db, {
        action: 'impersonate_stop',
        actorId: row.impersonatorUserId,
        targetId: row.targetUserId,
        metadata: auditMetadata({
          familyId: row.familyId,
          persistent: true,
          reason,
        }),
      });
    }
  }
}
