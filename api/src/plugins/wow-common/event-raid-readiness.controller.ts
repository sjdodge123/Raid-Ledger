import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { EventRaidReadiness } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../plugin-host/plugin-active.guard';
import { EventRaidReadinessService } from './event-raid-readiness.service';
import { WOW_COMMON_MANIFEST } from './manifest';

/**
 * ROK-1926: "Ready for next run" per-signup checks for a Forever event.
 * Same gate as quest readiness (WoW plugin + JWT); access lives in the service.
 */
@Controller('plugins/wow-classic')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class EventRaidReadinessController {
  constructor(private readonly readinessSvc: EventRaidReadinessService) {}

  /** GET /plugins/wow-classic/events/:eventId/raid-readiness */
  @Get('events/:eventId/raid-readiness')
  @UseGuards(AuthGuard('jwt'))
  readiness(
    @Request() req: AuthenticatedRequest,
    @Param('eventId', ParseIntPipe) eventId: number,
  ): Promise<EventRaidReadiness> {
    return this.readinessSvc.readiness(req.user, eventId);
  }
}
