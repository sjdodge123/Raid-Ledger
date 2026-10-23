import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { EventQuestReadinessDto } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../plugin-host/plugin-active.guard';
import { EventQuestReadinessService } from './event-quest-readiness.service';
import { WOW_COMMON_MANIFEST } from './manifest';

/**
 * ROK-1911 (H9 of ROK-1905): roster-wide quest readiness for a Forever event.
 * Gated behind the WoW plugin + JWT; access rules live in the service.
 */
@Controller('plugins/wow-classic')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class EventQuestReadinessController {
  constructor(private readonly readinessSvc: EventQuestReadinessService) {}

  /** GET /plugins/wow-classic/events/:eventId/quest-readiness */
  @Get('events/:eventId/quest-readiness')
  @UseGuards(AuthGuard('jwt'))
  readiness(
    @Request() req: AuthenticatedRequest,
    @Param('eventId', ParseIntPipe) eventId: number,
  ): Promise<EventQuestReadinessDto> {
    return this.readinessSvc.readiness(req.user, eventId);
  }
}
