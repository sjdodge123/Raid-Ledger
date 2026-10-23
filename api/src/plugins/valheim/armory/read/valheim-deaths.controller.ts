import { Controller, Get, Header, Param, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { ValheimDeathsResponse } from '@raid-ledger/contract';
import type { AuthenticatedExpressRequest } from '../../../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../../plugin-host/plugin-active.guard';
import { VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { armoryIdPipe } from '../valheim-armory-id.pipe';
import { ValheimDeathsService } from './valheim-deaths.service';

/**
 * ROK-1930 L2 — the hub Deaths widget: one bar per player, deaths desc.
 * Hub members and staff only (D6); everyone else gets the hub 404.
 */
@Controller()
@UseGuards(AuthGuard('jwt'), PluginActiveGuard)
@RequirePlugin(VALHEIM_PLUGIN_ID)
export class ValheimDeathsController {
  constructor(private readonly deaths: ValheimDeathsService) {}

  /** GET — per-player death counts and the "counted since" date. */
  @Get('plugins/valheim/armory/servers/:serverId/deaths')
  @Header('Cache-Control', 'private, no-store')
  list(
    @Param('serverId', armoryIdPipe) serverId: number,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<ValheimDeathsResponse> {
    return this.deaths.deaths(serverId, req.user);
  }
}
