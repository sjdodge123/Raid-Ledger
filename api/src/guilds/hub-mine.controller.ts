import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { MyGuilds } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../auth/types';
import { HubService } from './hub.service';

/**
 * ROK-1831 Q6 — `GET guilds/mine`, kind-agnostic: every hub the viewer
 * belongs to across live kinds, hidden hubs dropped for non-staff. Its own
 * controller so the literal path registers ahead of `guilds/:id`.
 * `plugins/wow/guilds/mine` stays as the WoW alias.
 */
@Controller('guilds/mine')
@UseGuards(AuthGuard('jwt'))
export class HubMineController {
  constructor(private readonly hubs: HubService) {}

  @Get()
  mine(@Request() req: AuthenticatedRequest): Promise<MyGuilds> {
    return this.hubs.mine(req.user);
  }
}
