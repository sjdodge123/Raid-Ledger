import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { HUB_DB, type HubDb } from '../drizzle/drizzle.module';
import { hubInstances, type HubInstanceRow } from '../drizzle/schema';

export interface PendingRegistration {
  readonly instanceId: string;
  readonly tokenHash: string;
  readonly version: string;
  readonly schemaVersion: number;
}

/** What `approve` did: the CLI maps each to its line and exit code. */
export type ApproveOutcome =
  'approved' | 'already_approved' | 'not_found' | 'revoked' | 'disconnected';

/** What `revoke` did (ROK-1672): the CLI maps each to its line and exit code. */
export type RevokeOutcome = 'revoked' | 'already_revoked' | 'not_found';

/** `hub_instances` access (ROK-1671). Shared by the API and `hub-admin`. */
@Injectable()
export class InstancesRepository {
  constructor(@Inject(HUB_DB) private readonly db: HubDb) {}

  async findById(instanceId: string): Promise<HubInstanceRow | undefined> {
    const rows = await this.db
      .select()
      .from(hubInstances)
      .where(eq(hubInstances.instanceId, instanceId))
      .limit(1);
    return rows[0];
  }

  /** The instance holding this token hash (`token_hash` is unique). */
  async findByTokenHash(
    tokenHash: string,
  ): Promise<HubInstanceRow | undefined> {
    const rows = await this.db
      .select()
      .from(hubInstances)
      .where(eq(hubInstances.tokenHash, tokenHash))
      .limit(1);
    return rows[0];
  }

  /**
   * Inserts a pending instance, or replaces a known one's token hash and
   * resets it to pending (L3), in ONE statement. A revoked row is left
   * untouched (the `WHERE` blocks the update) and undefined is returned.
   */
  async upsertPending(
    reg: PendingRegistration,
  ): Promise<HubInstanceRow | undefined> {
    const fields = {
      tokenHash: reg.tokenHash,
      status: 'pending' as const,
      trustTier: 'reader',
      version: reg.version,
      schemaVersion: reg.schemaVersion,
    };
    const rows = await this.db
      .insert(hubInstances)
      .values({ instanceId: reg.instanceId, ...fields })
      .onConflictDoUpdate({
        target: hubInstances.instanceId,
        set: { ...fields, approvedAt: null },
        setWhere: sql`${hubInstances.status} <> 'revoked'`,
      })
      .returning();
    return rows[0];
  }

  /** Approves a pending instance once (`trust_tier` → contributor). */
  async approve(instanceId: string): Promise<ApproveOutcome> {
    const updated = await this.db
      .update(hubInstances)
      .set({
        status: 'approved',
        trustTier: 'contributor',
        approvedAt: sql`now()`,
      })
      .where(
        and(
          eq(hubInstances.instanceId, instanceId),
          eq(hubInstances.status, 'pending'),
        ),
      )
      .returning({ id: hubInstances.instanceId });
    if (updated.length > 0) return 'approved';
    const current = await this.findById(instanceId);
    if (!current) return 'not_found';
    if (current.status === 'approved') return 'already_approved';
    return current.status === 'revoked' ? 'revoked' : 'disconnected';
  }

  /**
   * L5 (ROK-1672): marks the instance revoked and KEEPS its token hash, so
   * the guard can answer `revoked` to that token. The reason is stored only.
   */
  async revoke(instanceId: string, reason: string): Promise<RevokeOutcome> {
    const updated = await this.db
      .update(hubInstances)
      .set({ status: 'revoked', revokedAt: sql`now()`, revokeReason: reason })
      .where(
        and(
          eq(hubInstances.instanceId, instanceId),
          ne(hubInstances.status, 'revoked'),
        ),
      )
      .returning({ id: hubInstances.instanceId });
    if (updated.length > 0) return 'revoked';
    return (await this.findById(instanceId)) ? 'already_revoked' : 'not_found';
  }

  /** Every instance, oldest registration first (ties by id): deterministic. */
  list(): Promise<HubInstanceRow[]> {
    return this.db
      .select()
      .from(hubInstances)
      .orderBy(asc(hubInstances.registeredAt), asc(hubInstances.instanceId));
  }
}
