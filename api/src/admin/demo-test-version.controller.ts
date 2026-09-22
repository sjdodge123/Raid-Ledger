/**
 * DemoTestVersionController (ROK-1475, OQ-6).
 *
 * DEMO_MODE-only fixture that seeds the admin update-status signals, so a
 * fleet test-plan step can deep-link a known state ("3 fixes available",
 * "up to date", a feature release banner) instead of depending on live
 * GitHub data at check time.
 *
 *   POST /admin/test/seed-update-status
 *
 * A `null` field clears that setting ("unknown"); an omitted field is left
 * alone. The real check overwrites these on its next run (boot +10 s, then
 * daily at midnight), so seed AFTER the env has booted.
 */
import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS, type SettingKey } from '../drizzle/schema/app-settings';
import { parseDemoBody } from './demo-test.utils';

const SeedUpdateStatusSchema = z.object({
  updateAvailable: z.boolean().nullable().optional(),
  latestVersion: z.string().min(1).nullable().optional(),
  latestReleaseUrl: z.string().url().nullable().optional(),
  fixesAvailable: z.number().int().nonnegative().nullable().optional(),
  latestCommitSha: z.string().min(1).nullable().optional(),
  fixesCompareUrl: z.string().url().nullable().optional(),
});

type SeedBody = z.infer<typeof SeedUpdateStatusSchema>;

/** Body field → setting key, and how a present value is stored. */
const FIELD_KEYS: Array<[keyof SeedBody, SettingKey]> = [
  ['updateAvailable', SETTING_KEYS.UPDATE_AVAILABLE],
  ['latestVersion', SETTING_KEYS.LATEST_VERSION],
  ['latestReleaseUrl', SETTING_KEYS.LATEST_RELEASE_URL],
  ['fixesAvailable', SETTING_KEYS.FIXES_AVAILABLE],
  ['latestCommitSha', SETTING_KEYS.LATEST_COMMIT_SHA],
  ['fixesCompareUrl', SETTING_KEYS.FIXES_COMPARE_URL],
];

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestVersionController {
  constructor(private readonly settings: SettingsService) {}

  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    if (!(await this.settings.getDemoMode())) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }

  @Post('seed-update-status')
  @HttpCode(HttpStatus.OK)
  async seedUpdateStatus(
    @Body() body: unknown,
  ): Promise<{ success: boolean; seeded: string[] }> {
    await this.assertDemoMode();
    const parsed = parseDemoBody(SeedUpdateStatusSchema, body);
    const seeded: string[] = [];
    for (const [field, key] of FIELD_KEYS) {
      const value = parsed[field];
      if (value === undefined) continue;
      if (value === null) await this.settings.delete(key);
      else await this.settings.set(key, String(value));
      seeded.push(key);
    }
    await this.settings.set(
      SETTING_KEYS.VERSION_CHECK_LAST_RUN,
      new Date().toISOString(),
    );
    return { success: true, seeded };
  }
}
