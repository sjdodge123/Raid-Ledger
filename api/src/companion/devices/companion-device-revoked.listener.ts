/**
 * ROK-2099 D6 — data a member withdrew by revoking a Companion device is
 * deleted with it. Core-owned (not a plugin behaviour): it runs whether or
 * not the plugin that wrote the rows is active, so switching `blizzard` off
 * never strands a revoked device's addon-error rows.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';

export const COMPANION_DEVICE_REVOKED_EVENT = 'companion.device.revoked';

export interface CompanionDeviceRevokedPayload {
  userId: number;
  deviceId: number;
}

const logger = new Logger('CompanionDeviceRevokedListener');

@Injectable()
export class CompanionDeviceRevokedListener {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Never throws: the revoke itself has already committed. */
  @OnEvent(COMPANION_DEVICE_REVOKED_EVENT)
  async onRevoked(payload: CompanionDeviceRevokedPayload): Promise<void> {
    const t = schema.wowAddonErrorRecords;
    try {
      await this.db
        .delete(t)
        .where(
          and(eq(t.userId, payload.userId), eq(t.deviceId, payload.deviceId)),
        );
    } catch (err) {
      logger.error(
        `revoke cleanup for device ${payload.deviceId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
