import { Body, Controller, Get, Header, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { EventPlanningForumSettingsDto } from '@raid-ledger/contract';
import { AdminGuard } from '../../../auth/admin.guard';
import { EventPlanningForumAdmin } from './event-planning-forum.admin';

/**
 * ROK-2272 S5a — Admin → Discord "Event planning forum" card: which bound
 * forum non-hub events, polls and lineups post into when the Discord guild
 * has ≥2. Every route is `jwt + AdminGuard`.
 */
@Controller('admin/discord/event-planning-forum')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class EventPlanningForumAdminController {
  constructor(private readonly admin: EventPlanningForumAdmin) {}

  /** The stored pick, the candidates, the resolved forum and any warning. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(): Promise<EventPlanningForumSettingsDto> {
    return this.admin.read();
  }

  /** `{ channelId: string | null }` — a current candidate, or null to clear. */
  @Put()
  put(@Body() body: unknown): Promise<EventPlanningForumSettingsDto> {
    return this.admin.update(body);
  }
}
