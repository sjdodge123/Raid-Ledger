/**
 * DemoTestLineupController (ROK-1069).
 *
 * Lineup edge-case test endpoints used by the Playwright + companion-bot
 * smoke fixtures that cover the six enumerated edge cases:
 *
 *   - empty participation (zero nominations)
 *   - single voter
 *   - private DM-only notifications
 *   - channel-override happy path + fallback on perm loss
 *   - admin abort from each phase
 *   - public-share toggle accessibility + 404
 *
 * All endpoints are DEMO_MODE-only. The controller is a thin parser /
 * gate; the actual DB writes live in `demo-test-lineup-edge.helpers.ts`.
 */
import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import {
  advanceLineupToVotingForTest,
  castVoteForTest,
  setLineupVisibilityForTest,
  setLineupChannelOverrideForTest,
} from './demo-test-lineup-edge.helpers';
import {
  AdvanceLineupZeroNomsSchema,
  SeedSingleVoterSchema,
  SetLineupPrivateSchema,
  RevokeChannelPermsSchema,
} from './demo-test.schemas';
import { parseDemoBody } from './demo-test.utils';

@Controller('admin/test/lineup')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestLineupController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
  ) {}

  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    if (!(await this.settingsService.getDemoMode())) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }

  /**
   * Force a lineup into `voting` with zero nominations — used by the
   * empty-participation edge-case spec.
   */
  @Post('advance-with-zero-noms')
  @HttpCode(HttpStatus.OK)
  async advanceWithZeroNoms(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    const parsed = parseDemoBody(AdvanceLineupZeroNomsSchema, body);
    await advanceLineupToVotingForTest(this.db, parsed.lineupId);
    return { success: true };
  }

  /**
   * Insert a single vote row directly. Pair with `nominate-game` and
   * `advance-with-zero-noms` (after the lineup has at least one nom)
   * to drive the single-voter scenario.
   */
  @Post('seed-single-voter')
  @HttpCode(HttpStatus.OK)
  async seedSingleVoter(@Body() body: unknown): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    const parsed = parseDemoBody(SeedSingleVoterSchema, body);
    await castVoteForTest(
      this.db,
      parsed.lineupId,
      parsed.gameId,
      parsed.userId,
    );
    return { success: true };
  }

  /** Flip a lineup's visibility (defaults to `private`). */
  @Post('set-private')
  @HttpCode(HttpStatus.OK)
  async setPrivate(@Body() body: unknown): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    const parsed = parseDemoBody(SetLineupPrivateSchema, body);
    await setLineupVisibilityForTest(
      this.db,
      parsed.lineupId,
      parsed.visibility ?? 'private',
    );
    return { success: true };
  }

  /**
   * Set `channelOverrideId` directly. Pass an invalid snowflake to
   * simulate the bot losing post permissions; pass null to clear the
   * override.
   */
  @Post('revoke-channel-perms')
  @HttpCode(HttpStatus.OK)
  async revokeChannelPerms(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    const parsed = parseDemoBody(RevokeChannelPermsSchema, body);
    await setLineupChannelOverrideForTest(
      this.db,
      parsed.lineupId,
      parsed.channelOverrideId,
    );
    return { success: true };
  }
}
