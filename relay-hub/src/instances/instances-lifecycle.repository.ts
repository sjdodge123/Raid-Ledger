import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { HUB_DB, type HubDb } from '../drizzle/drizzle.module';
import { hubInstances } from '../drizzle/schema';

/**
 * Writes an authenticated instance makes about itself (ROK-1672). Every write
 * re-checks the token hash and that the row is not revoked, so a re-register
 * or revoke landing after the guard's read is never undone.
 */
@Injectable()
export class InstancesLifecycleRepository {
  constructor(@Inject(HUB_DB) private readonly db: HubDb) {}

  /** Stamps `last_heartbeat_at` and the reported version; false if the token moved on. */
  async touchHeartbeat(
    instanceId: string,
    tokenHash: string,
    version: string,
  ): Promise<boolean> {
    const rows = await this.db
      .update(hubInstances)
      .set({ lastHeartbeatAt: new Date(), version })
      .where(this.ownedBy(instanceId, tokenHash))
      .returning({ id: hubInstances.instanceId });
    return rows.length > 0;
  }

  /** L4: clears the token and marks the instance disconnected. */
  async disconnect(instanceId: string, tokenHash: string): Promise<boolean> {
    const rows = await this.db
      .update(hubInstances)
      .set({ status: 'disconnected', tokenHash: null })
      .where(this.ownedBy(instanceId, tokenHash))
      .returning({ id: hubInstances.instanceId });
    return rows.length > 0;
  }

  private ownedBy(instanceId: string, tokenHash: string) {
    return and(
      eq(hubInstances.instanceId, instanceId),
      eq(hubInstances.tokenHash, tokenHash),
      ne(hubInstances.status, 'revoked'),
    );
  }
}
