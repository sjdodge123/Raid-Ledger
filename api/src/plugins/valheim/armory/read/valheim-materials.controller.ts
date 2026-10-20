import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type {
  ValheimContainerDetail,
  ValheimContainerListResponse,
  ValheimMaterialsResponse,
} from '@raid-ledger/contract';
import type { AuthenticatedExpressRequest } from '../../../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../../plugin-host/plugin-active.guard';
import { VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { armoryIdPipe } from '../valheim-armory-id.pipe';
import {
  parseContainerKey,
  parseIncludeVehicles,
} from './valheim-materials.mappers';
import { ValheimMaterialsService } from './valheim-materials.service';

const BASE = 'plugins/valheim/armory/servers/:serverId';
/** D9: every response depends on the viewer. */
const NO_STORE = 'private, no-store';

/**
 * ROK-1853 L3 — the hub Materials tab. Signed-in members only; a hidden or
 * missing hub → 404; personal chests are filtered in SQL (D5), and a chest
 * the viewer may not see answers exactly like one that does not exist.
 */
@Controller()
@UseGuards(AuthGuard('jwt'), PluginActiveGuard)
@RequirePlugin(VALHEIM_PLUGIN_ID)
export class ValheimMaterialsController {
  constructor(private readonly materials: ValheimMaterialsService) {}

  /** GET — shared totals, the viewer's personal block, catalogue subset. */
  @Get(`${BASE}/materials`)
  @Header('Cache-Control', NO_STORE)
  totals(
    @Param('serverId', armoryIdPipe) serverId: number,
    @Query('includeVehicles') includeVehicles: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<ValheimMaterialsResponse> {
    const vehicles = parseIncludeVehicles(includeVehicles);
    return this.materials.materials(serverId, req.user, vehicles);
  }

  /** GET — visible chests with positions, sorted prefab, x, z, y. */
  @Get(`${BASE}/containers`)
  @Header('Cache-Control', NO_STORE)
  list(
    @Param('serverId', armoryIdPipe) serverId: number,
    @Query('includeVehicles') includeVehicles: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<ValheimContainerListResponse> {
    const vehicles = parseIncludeVehicles(includeVehicles);
    return this.materials.containers(serverId, req.user, vehicles);
  }

  /** GET — one chest's stacks by its opaque key (D7). */
  @Get(`${BASE}/containers/:key`)
  @Header('Cache-Control', NO_STORE)
  detail(
    @Param('serverId', armoryIdPipe) serverId: number,
    @Param('key') key: string,
    @Query('includeVehicles') includeVehicles: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<ValheimContainerDetail> {
    const vehicles = parseIncludeVehicles(includeVehicles);
    const k = parseContainerKey(key);
    return this.materials.container(serverId, k, req.user, vehicles);
  }
}
