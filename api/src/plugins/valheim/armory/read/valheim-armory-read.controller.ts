import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type {
  ValheimCharacterDetail,
  ValheimCharacterListResponse,
  ValheimMapMeta,
} from '@raid-ledger/contract';
import { AdminGuard } from '../../../../auth/admin.guard';
import { RateLimit } from '../../../../throttler/rate-limit.decorator';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../../plugin-host/plugin-active.guard';
import { VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { armoryIdPipe } from '../valheim-armory-id.pipe';
import { parseArmoryListQuery } from './valheim-armory-read.query';
import {
  ValheimArmoryReadService,
  type ValheimAdminCharacterListResponse,
} from './valheim-armory-read.service';

/** Positive int4 path param (400 otherwise). */
const idPipe = armoryIdPipe;

/**
 * ROK-1835 L4 armory reads. Members: any signed-in user (signed-out → 401;
 * the JWT strategy refuses deactivated accounts). Member responses never
 * carry a SteamID64; the admin list is the only route that does.
 */
@Controller()
@UseGuards(AuthGuard('jwt'), PluginActiveGuard)
@RequirePlugin(VALHEIM_PLUGIN_ID)
export class ValheimArmoryReadController {
  constructor(private readonly reads: ValheimArmoryReadService) {}

  /** GET — characters sorted by name; `serverId`, `page`, `pageSize` ≤100. */
  @Get('plugins/valheim/armory/characters')
  list(@Query() query: unknown): Promise<ValheimCharacterListResponse> {
    return this.reads.list(parseArmoryListQuery(query));
  }

  /** GET — one character's sheet and map refs. */
  @Get('plugins/valheim/armory/characters/:id')
  detail(@Param('id', idPipe) id: number): Promise<ValheimCharacterDetail> {
    return this.reads.detail(id);
  }

  /** GET — map metadata (no bytes, no fog — V7). */
  @Get('plugins/valheim/armory/characters/:id/maps/:mapId')
  map(
    @Param('id', idPipe) id: number,
    @Param('mapId', idPipe) mapId: number,
  ): Promise<ValheimMapMeta> {
    return this.reads.map(id, mapId);
  }

  /** GET (admin) — owner-management list incl. `steamId64`; `unclaimed=true`. */
  @Get('admin/plugins/valheim/armory/characters')
  @UseGuards(AdminGuard)
  @RateLimit('admin')
  adminList(
    @Query() query: unknown,
  ): Promise<ValheimAdminCharacterListResponse> {
    return this.reads.adminList(parseArmoryListQuery(query));
  }
}
