/**
 * DemoTestResetService (ROK-1186).
 *
 * One holistic reset endpoint for smoke + Playwright setups: wipes
 * all test-created data and re-runs the demo installer. Preserves
 * admin user, demo seed users (re-created by installer), demo seed
 * games, app_settings (Blizzard creds, demo-install flag), and
 * drizzle migration metadata.
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { DemoDataService } from './demo-data.service';
import { QueueHealthService } from '../queue/queue-health.service';
import { SettingsService } from '../settings/settings.service';
import { wipeAllTestData, type WipeCounts } from './demo-test-reset.helpers';

/** Result returned from `POST /admin/test/reset-to-seed`. */
export interface ResetToSeedResult {
  success: boolean;
  deleted: WipeCounts;
  reseed: { ok: boolean; message?: string };
}

@Injectable()
export class DemoTestResetService {
  private readonly logger = new Logger(DemoTestResetService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly demoDataService: DemoDataService,
    private readonly settingsService: SettingsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Wipe → reseed → drain. Returns counts of wiped rows and the
   * reseed result. Idempotent: calling it on an already-clean DB
   * is fast (no-op wipe) and produces the same final state.
   */
  async resetToSeed(): Promise<ResetToSeedResult> {
    this.logger.log('reset-to-seed: wiping test data...');
    const deleted = await wipeAllTestData(this.db);
    this.logger.log(
      `reset-to-seed: wiped ${describeCounts(deleted)} — reseeding...`,
    );
    const reseed = await this.runReseed();
    await this.drainQueues();
    this.logger.log('reset-to-seed: complete');
    return { success: reseed.ok, deleted, reseed };
  }

  /**
   * Wait until BullMQ queues are idle. installDemoData enqueues
   * background work (taste-profile aggregation, embed sync); without
   * this, smoke/Playwright can race against post-reseed jobs.
   * `awaitDrained` polls active+waiting until both are zero.
   */
  private async drainQueues(): Promise<void> {
    const queueHealth = this.moduleRef.get(QueueHealthService, {
      strict: false,
    });
    await queueHealth.awaitDrained();
  }

  /**
   * Run clearDemoData → installDemoData. The clear path is required:
   * installDemoData refuses to run when demo users already exist,
   * and our broader wipe preserves users by design (admin must survive).
   * Clear deletes ONLY the canonical demo users (those in DEMO_USERNAMES),
   * leaving admin and any other non-demo accounts intact.
   *
   * Re-asserts demoMode=true between clear and install: clearDemoData
   * sets demoMode=false at the end of performClear, which would briefly
   * 403 any DEMO_MODE-gated endpoint called concurrently. installDemoData
   * sets it back to true at the end, so this just shrinks the window.
   */
  private async runReseed(): Promise<{ ok: boolean; message?: string }> {
    const cleared = await this.demoDataService.clearDemoData();
    if (!cleared.success) {
      return { ok: false, message: `clear failed: ${cleared.message}` };
    }
    await this.settingsService.setDemoMode(true);
    const installed = await this.demoDataService.installDemoData();
    if (installed.success) return { ok: true };
    return { ok: false, message: installed.message };
  }
}

/** Compact summary string for log output. */
function describeCounts(c: WipeCounts): string {
  return (
    `events=${c.events} signups=${c.signups} lineups=${c.lineups} ` +
    `characters=${c.characters} voice=${c.voiceSessions}`
  );
}
