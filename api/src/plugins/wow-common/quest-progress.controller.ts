import {
  Controller,
  Get,
  Put,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { QuestProgressService } from './quest-progress.service';
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
  constructor(private readonly questProgressService: QuestProgressService) {}

  /**
   * GET /plugins/wow-classic/events/:eventId/quest-progress
   *
   * Returns all quest progress entries for an event (all players).
   */
  @Get('events/:eventId/quest-progress')
  @UseGuards(AuthGuard('jwt'))
  async getProgressForEvent(@Param('eventId', ParseIntPipe) eventId: number) {
    return this.questProgressService.getProgressForEvent(eventId);
  }

  /**
   * GET /plugins/wow-classic/events/:eventId/quest-coverage
   *
   * Returns sharable quest coverage — which quests are covered by whom.
   */
  @Get('events/:eventId/quest-coverage')
  @UseGuards(AuthGuard('jwt'))
  async getCoverageForEvent(@Param('eventId', ParseIntPipe) eventId: number) {
    return this.questProgressService.getCoverageForEvent(eventId);
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
    return this.questProgressService.updateProgress(
      eventId,
      req.user.id,
      parsed.data.questId,
      { pickedUp: parsed.data.pickedUp, completed: parsed.data.completed },
    );
  }
}
