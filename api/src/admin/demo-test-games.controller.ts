import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { DemoTestService } from './demo-test.service';
import { DemoTestLineupService } from './demo-test-lineup.service';
import { LineupSteamNudgeService } from '../lineups/lineup-steam-nudge.service';
import {
  AddGameInterestSchema,
  SetSteamAppIdSchema,
  GetGameSchema,
  ClearGameInterestSchema,
  SetAutoHeartPrefSchema,
  CancelLineupPhaseJobsSchema,
  CreateBuildingLineupSchema,
  NominateGameTestSchema,
  ArchiveLineupSchema,
  SetAutoNominatePrefSchema,
} from './demo-test.schemas';
import { parseDemoBody } from './demo-test.utils';

/**
 * Game/lineup test endpoints — DEMO_MODE only (smoke tests).
 */
@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestGamesController {
  constructor(
    private readonly demoTestService: DemoTestService,
    private readonly demoTestLineup: DemoTestLineupService,
    private readonly steamNudge: LineupSteamNudgeService,
  ) {}

  /** Add a game interest for a user -- DEMO_MODE only (smoke tests). */
  @Post('add-game-interest')
  @HttpCode(HttpStatus.OK)
  async addGameInterestForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = parseDemoBody(AddGameInterestSchema, body);
    await this.demoTestService.addGameInterestForTest(
      parsed.userId,
      parsed.gameId,
    );
    return { success: true };
  }

  /** Clear game interests for a user/game — DEMO_MODE only (ROK-966 smoke test). */
  @Post('clear-game-interest')
  @HttpCode(HttpStatus.OK)
  async clearGameInterestForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = parseDemoBody(ClearGameInterestSchema, body);
    await this.demoTestService.clearGameInterestForTest(
      parsed.userId,
      parsed.gameId,
    );
    return { success: true };
  }

  /** Set steamAppId on a game — DEMO_MODE only (ROK-966 smoke test). */
  @Post('set-steam-app-id')
  @HttpCode(HttpStatus.OK)
  async setSteamAppIdForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = parseDemoBody(SetSteamAppIdSchema, body);
    await this.demoTestService.setSteamAppIdForTest(
      parsed.gameId,
      parsed.steamAppId,
    );
    return { success: true };
  }

  /** Fetch a game by id — DEMO_MODE only (ROK-1054 smoke test). */
  @Post('get-game')
  @HttpCode(HttpStatus.OK)
  async getGameForTest(@Body() body: unknown) {
    const { id } = parseDemoBody(GetGameSchema, body);
    const game = await this.demoTestService.getGameForTest(id);
    if (!game) throw new NotFoundException('Game not found');
    return game;
  }

  /** Set autoHeartSteamUrls preference for a user — DEMO_MODE only (ROK-1054). */
  @Post('set-auto-heart-pref')
  @HttpCode(HttpStatus.OK)
  async setAutoHeartPrefForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = parseDemoBody(SetAutoHeartPrefSchema, body);
    await this.demoTestService.setAutoHeartPrefForTest(
      parsed.userId,
      parsed.enabled,
    );
    return { success: true };
  }

  /** Trigger steam nudge DMs for a lineup — DEMO_MODE only. */
  @Post('trigger-steam-nudge')
  @HttpCode(HttpStatus.OK)
  async triggerSteamNudge(
    @Body() body: { lineupId: number },
  ): Promise<{ success: boolean }> {
    await this.steamNudge.nudgeUnlinkedMembers(body.lineupId);
    return { success: true };
  }

  /** Cancel all pending BullMQ phase-transition jobs for a lineup — DEMO_MODE only (ROK-1007). */
  @Post('cancel-lineup-phase-jobs')
  @HttpCode(HttpStatus.OK)
  async cancelLineupPhaseJobsForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean; removed: number }> {
    const parsed = parseDemoBody(CancelLineupPhaseJobsSchema, body);
    const removed = await this.demoTestService.cancelLineupPhaseJobsForTest(
      parsed.lineupId,
    );
    return { success: true, removed };
  }

  /** Set autoNominateSteamUrls preference — DEMO_MODE only (ROK-1081). */
  @Post('set-auto-nominate-pref')
  @HttpCode(HttpStatus.OK)
  async setAutoNominatePrefForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = parseDemoBody(SetAutoNominatePrefSchema, body);
    await this.demoTestLineup.setAutoNominatePrefForTest(
      parsed.userId,
      parsed.enabled,
    );
    return { success: true };
  }

  /** Create a building-phase lineup for smoke tests — DEMO_MODE only (ROK-1081). */
  @Post('create-building-lineup')
  @HttpCode(HttpStatus.OK)
  async createBuildingLineupForTest(
    @Body() body: unknown,
  ): Promise<{ lineupId: number }> {
    const parsed = parseDemoBody(CreateBuildingLineupSchema, body);
    return this.demoTestLineup.createBuildingLineupForTest(
      parsed.createdByUserId,
    );
  }

  /** Insert a nomination directly — DEMO_MODE only (ROK-1081). */
  @Post('nominate-game')
  @HttpCode(HttpStatus.OK)
  async nominateGameForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = parseDemoBody(NominateGameTestSchema, body);
    await this.demoTestLineup.nominateGameForTest(
      parsed.lineupId,
      parsed.gameId,
      parsed.userId,
    );
    return { success: true };
  }

  /** Archive a specific lineup — DEMO_MODE only (ROK-1081). */
  @Post('archive-lineup')
  @HttpCode(HttpStatus.OK)
  async archiveLineupForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = parseDemoBody(ArchiveLineupSchema, body);
    await this.demoTestLineup.archiveLineupForTest(parsed.lineupId);
    return { success: true };
  }

  /** Archive any active lineup — DEMO_MODE only (ROK-1081). */
  @Post('archive-active-lineup')
  @HttpCode(HttpStatus.OK)
  async archiveActiveLineupForTest(): Promise<{ success: boolean }> {
    await this.demoTestLineup.archiveActiveLineupForTest();
    return { success: true };
  }

  /**
   * Archive every non-archived lineup (ROK-1147). DEMO_MODE only.
   *
   * Smoke specs call this in their per-worker `beforeAll` so each
   * lineup-* file starts with an empty active-lineup slot, eliminating
   * the cross-worker race where one worker's archive sweep wipes another
   * worker's just-created lineup.
   */
  @Post('reset-lineups')
  @HttpCode(HttpStatus.OK)
  async resetLineupsForTest(): Promise<{
    success: boolean;
    archivedCount: number;
  }> {
    const { archivedCount } =
      await this.demoTestLineup.resetLineupsForTest();
    return { success: true, archivedCount };
  }
}
