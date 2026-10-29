import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ValheimServerPortalsQuerySchema,
  ValheimServerPortalsResponseSchema,
  type ValheimServerPortalsResponse,
} from '@raid-ledger/contract';
import type { AuthenticatedExpressRequest } from '../../../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../../plugin-host/plugin-active.guard';
import { VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { armoryIdPipe } from '../valheim-armory-id.pipe';
import { ValheimServerPortalsService } from './valheim-server-portals.service';

/**
 * ROK-1946 D6/D8 — the Map tab's scanned-portal layer for one server.
 * Signed-in only (JWT → 401); the service owns the D7 hub audience.
 */
@Controller()
@UseGuards(AuthGuard('jwt'), PluginActiveGuard)
@RequirePlugin(VALHEIM_PLUGIN_ID)
export class ValheimServerPortalsController {
  constructor(private readonly portals: ValheimServerPortalsService) {}

  /** GET — the world's latest scan, portals ordered x, z. */
  @Get('plugins/valheim/armory/servers/:serverId/portals')
  @Header('Cache-Control', 'private, max-age=60')
  async list(
    @Param('serverId', armoryIdPipe) serverId: number,
    @Query() query: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<ValheimServerPortalsResponse> {
    const parsed = ValheimServerPortalsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid worldUid');
    const body = await this.portals.portals(
      serverId,
      parsed.data.worldUid,
      req.user,
    );
    return ValheimServerPortalsResponseSchema.parse(body);
  }
}
