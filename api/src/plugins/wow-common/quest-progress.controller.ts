import {
  Controller,
  Get,
  Put,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  Req,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { QuestProgressService } from './quest-progress.service';
import { QuestProgressReadService } from './quest-progress-read.service';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from './manifest';
import { UpdateQuestProgressBodySchema } from '@raid-ledger/contract';

/**
 * API controller for per-event quest progress tracking.
 * All routes gated behind PluginActiveGuard + JWT auth.
 *
 * ROK-246: Dungeon Companion — Quest Suggestions UI
 */
@Controller('plugins/wow-classic')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class QuestProgressController {
  constructor(
    private readonly questProgressService: QuestProgressService,
    private readonly reads: QuestProgressReadService,
  ) {}

  /**
   * GET /plugins/wow-classic/events/:eventId/quest-progress
   *
   * Returns all quest progress entries for an event (all players).
   */
  @Get('events/:eventId/quest-progress')
  @UseGuards(AuthGuard('jwt'))
  async getProgressForEvent(@Param('eventId', ParseIntPipe) eventId: number) {
    return this.reads.getProgressForEvent(eventId);
  }

  /**
   * GET /plugins/wow-classic/events/:eventId/quest-coverage
   *
   * Returns sharable quest coverage — which quests are covered by whom.
   */
  @Get('events/:eventId/quest-coverage')
  @UseGuards(AuthGuard('jwt'))
  async getCoverageForEvent(@Param('eventId', ParseIntPipe) eventId: number) {
    return this.reads.getCoverageForEvent(eventId);
  }

  /**
   * GET /plugins/wow-classic/events/:eventId/quest-prereqs/me (ROK-1748 D11)
   *
   * The viewer's pre-req chain state, or a JSON `null` body when the event is
   * not Forever or the viewer has no Forever character with a quests snapshot
   * (Nest sends an EMPTY body for a returned null, which clients cannot parse).
   */
  @Get('events/:eventId/quest-prereqs/me')
  @UseGuards(AuthGuard('jwt'))
  async getMyPrereqs(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Req() req: { user: { id: number } },
    @Res() res: Response,
  ): Promise<void> {
    res.json(await this.reads.getPrereqsForViewer(eventId, req.user.id));
  }

  /**
   * PUT /plugins/wow-classic/events/:eventId/quest-progress
   *
   * Update the current user's progress on a quest for an event.
   */
  @Put('events/:eventId/quest-progress')
  @UseGuards(AuthGuard('jwt'))
  async updateProgress(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() body: { questId: number; pickedUp?: boolean; completed?: boolean },
    @Req() req: { user: { id: number } },
  ) {
    if (!req.user?.id) {
      throw new BadRequestException('User ID is required');
    }
    const parsed = UpdateQuestProgressBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    const { questId, pickedUp, completed } = parsed.data;
    return this.questProgressService.updateProgress(
      eventId,
      req.user.id,
      questId,
      {
        ...(pickedUp !== undefined ? { pickedUp } : {}),
        ...(completed !== undefined ? { completed } : {}),
      },
    );
  }
}
