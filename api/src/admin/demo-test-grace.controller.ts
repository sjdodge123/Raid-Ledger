/**
 * DemoTestGraceController (ROK-1253, ROK-1296).
 *
 * DEMO_MODE-only endpoints used by the lineup-grace-countdown smoke test:
 *
 *   - POST /admin/test/set-setting   — UPSERT/clear an app setting by key.
 *   - POST /admin/test/cast-vote     — toggle a vote without needing a
 *                                       per-user JWT (smoke fixture
 *                                       impersonates members via userId).
 *   - POST /admin/test/submit-votes  — (ROK-1296) fire the new submit-votes
 *                                       endpoint for a given userId so smoke
 *                                       fixtures can close the per-voter
 *                                       quorum gate without minting JWTs.
 *
 * All endpoints are off in production builds (guarded by `assertDemoMode`).
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
import { LineupsService } from '../lineups/lineups.service';
import { LineupSubmitService } from '../lineups/submit/lineup-submit.service';
import { SETTING_KEYS, type SettingKey } from '../drizzle/schema/app-settings';
import { parseDemoBody } from './demo-test.utils';

const SetSettingSchema = z.object({
  key: z.string().min(1),
  /** When null/undefined the setting is deleted. */
  value: z.string().nullable().optional(),
});

const CastVoteSchema = z.object({
  lineupId: z.number().int().positive(),
  gameId: z.number().int().positive(),
  userId: z.number().int().positive(),
});

const SubmitVotesSchema = z.object({
  lineupId: z.number().int().positive(),
  userId: z.number().int().positive(),
});

/** Whitelist of setting keys this endpoint accepts. */
const KNOWN_KEYS = new Set<string>(Object.values(SETTING_KEYS));

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestGraceController {
  constructor(
    private readonly settings: SettingsService,
    private readonly lineupsService: LineupsService,
    private readonly submitService: LineupSubmitService,
  ) {}

  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    if (!(await this.settings.getDemoMode())) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }

  /**
   * UPSERT or clear an app-settings entry. Used to fast-forward TTL-style
   * settings (e.g. `LINEUP_AUTO_ADVANCE_GRACE_MS=3000`) during smoke tests.
   */
  @Post('set-setting')
  @HttpCode(HttpStatus.OK)
  async setSetting(@Body() body: unknown): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    const parsed = parseDemoBody(SetSettingSchema, body);
    if (!KNOWN_KEYS.has(parsed.key)) {
      throw new ForbiddenException(`Unknown setting key: ${parsed.key}`);
    }
    if (parsed.value == null) {
      await this.settings.delete(parsed.key as SettingKey);
    } else {
      await this.settings.set(parsed.key as SettingKey, parsed.value);
    }
    return { success: true };
  }

  /**
   * Toggle-aware vote for a given user on a given game. Mirrors the
   * `POST /lineups/:id/vote` endpoint but takes `userId` so smoke fixtures
   * can drive multiple members without minting JWTs.
   */
  @Post('cast-vote')
  @HttpCode(HttpStatus.OK)
  async castVote(@Body() body: unknown): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    const parsed = parseDemoBody(CastVoteSchema, body);
    await this.lineupsService.toggleVote(
      parsed.lineupId,
      parsed.gameId,
      parsed.userId,
      'admin',
    );
    return { success: true };
  }

  /**
   * ROK-1296: fire the new `POST /lineups/:id/submit-votes` endpoint
   * impersonating `userId` so smoke fixtures can close the per-voter
   * quorum gate without minting per-user JWTs. Mirrors `cast-vote`'s
   * shape but stamps `community_lineup_user_submissions.votes_submitted_at`.
   */
  @Post('submit-votes')
  @HttpCode(HttpStatus.OK)
  async submitVotes(@Body() body: unknown): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    const parsed = parseDemoBody(SubmitVotesSchema, body);
    await this.submitService.submitVotes(
      parsed.lineupId,
      parsed.userId,
      'admin',
    );
    return { success: true };
  }
}
