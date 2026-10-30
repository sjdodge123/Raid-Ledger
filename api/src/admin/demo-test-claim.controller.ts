/**
 * ROK-1701 OQ-8d: DEMO_MODE fixture for the claim flow (fleet test plan).
 * Arms a claim with a CALLER-SUPPLIED code (the fixture never returns one),
 * forces the soft lock, and resets — restoring admin@local's original
 * password hash from the snapshot taken at the first arm.
 */
import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import { AdminGuard } from '../auth/admin.guard';
import { DemoModeGuard } from './demo-mode.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { parseDemoBody } from './demo-test.utils';
import { hashClaimCode } from '../setup-claim/claim-code.helpers';
import {
  armClaim,
  clearClaimState,
  deleteRestoreHash,
  readRestoreHash,
  writeRestoreHash,
} from '../setup-claim/claim-state.repository';
import {
  readAdminPasswordHash,
  setAdminPasswordHash,
} from '../setup-claim/claim-admin.repository';
import { ClaimLockService } from '../setup-claim/claim-lock.service';

const DEFAULT_ARM_MINUTES = 72 * 60;

const ArmClaimSchema = z.object({
  code: z.string().trim().min(1).max(256),
  /** Negative ⇒ already expired (the 410 step). */
  expiresInMinutes: z.number().int().min(-10_080).max(43_200).optional(),
});

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestClaimController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
    private readonly lock: ClaimLockService,
  ) {}

  private async assertDemoMode(): Promise<void> {
    const demoMode =
      process.env.DEMO_MODE === 'true' &&
      (await this.settingsService.getDemoMode());
    if (!demoMode) throw new ForbiddenException('Only available in DEMO_MODE');
  }

  /** Arm (or re-arm) with the caller's code; clears `claimed_at`. */
  @Post('claim/arm')
  @HttpCode(HttpStatus.OK)
  async arm(@Body() body: unknown): Promise<{ expiresAt: string }> {
    await this.assertDemoMode();
    const parsed = parseDemoBody(ArmClaimSchema, body);
    await this.snapshotAdminHash();
    const minutes = parsed.expiresInMinutes ?? DEFAULT_ARM_MINUTES;
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    await clearClaimState(this.db);
    await armClaim(this.db, {
      codeHash: hashClaimCode(parsed.code),
      expiresAt,
    });
    this.lock.reset();
    return { expiresAt: expiresAt.toISOString() };
  }

  /** Force the soft lock (shows the 429 state without 100 requests). */
  @Post('claim/lock')
  @HttpCode(HttpStatus.OK)
  async forceLock(): Promise<{ lockedUntil: string }> {
    await this.assertDemoMode();
    return { lockedUntil: this.lock.forceLock().toISOString() };
  }

  /** Drop every claim key, restore admin@local's hash, clear the lock. */
  @Post('claim/reset')
  @HttpCode(HttpStatus.OK)
  async reset(): Promise<{ restored: boolean }> {
    await this.assertDemoMode();
    await clearClaimState(this.db);
    const snapshot = await readRestoreHash(this.db);
    if (snapshot !== null) {
      await setAdminPasswordHash(this.db, snapshot);
      await deleteRestoreHash(this.db);
    }
    this.lock.reset();
    return { restored: snapshot !== null };
  }

  /** Snapshot admin@local's hash once (a re-arm keeps the first snapshot). */
  private async snapshotAdminHash(): Promise<void> {
    if ((await readRestoreHash(this.db)) !== null) return;
    const current = await readAdminPasswordHash(this.db);
    if (current !== null) await writeRestoreHash(this.db, current);
  }
}
