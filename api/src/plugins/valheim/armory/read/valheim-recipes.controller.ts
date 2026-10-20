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
  ValheimRecipeCatalogResponse,
  ValheimRecipePlanResponse,
  ValheimRecipeTreeResponse,
} from '@raid-ledger/contract';
import type { AuthenticatedExpressRequest } from '../../../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../../plugin-host/plugin-active.guard';
import { VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { armoryIdPipe } from '../valheim-armory-id.pipe';
import { parseIncludeVehicles } from './valheim-materials.mappers';
import {
  parseIncludePersonal,
  parsePlanTargets,
  parseRecipePrefab,
  parseTreeKind,
  parseTreeQuality,
} from './valheim-recipes.read.mappers';
import { ValheimRecipesService } from './valheim-recipes.service';

const BASE = 'plugins/valheim/armory/servers/:serverId/recipes';
/** D8: the plan is viewer-dependent; all three hinge on the hub check. */
const NO_STORE = 'private, no-store';

/**
 * ROK-1854 L3 — the hub Planner tab. Signed-in members only; a hidden or
 * missing hub → 404. `/plan` is declared before `/:prefab/tree` for
 * readability (the paths cannot collide: the tree has a `/tree` suffix).
 */
@Controller()
@UseGuards(AuthGuard('jwt'), PluginActiveGuard)
@RequirePlugin(VALHEIM_PLUGIN_ID)
export class ValheimRecipesController {
  constructor(private readonly recipes: ValheimRecipesService) {}

  /** GET — the planner catalogue (items, pieces, stations, atlases). */
  @Get(BASE)
  @Header('Cache-Control', NO_STORE)
  catalogue(
    @Param('serverId', armoryIdPipe) serverId: number,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<ValheimRecipeCatalogResponse> {
    return this.recipes.catalogue(serverId, req.user);
  }

  /** GET — `targets=<prefab>:<q>:<n>[:<fromQ>],…` netted against stock. */
  @Get(`${BASE}/plan`)
  @Header('Cache-Control', NO_STORE)
  plan(
    @Param('serverId', armoryIdPipe) serverId: number,
    @Query('targets') targets: unknown,
    @Query('includePersonal') includePersonal: unknown,
    @Query('includeVehicles') includeVehicles: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<ValheimRecipePlanResponse> {
    const list = parsePlanTargets(targets);
    const opts = {
      includePersonal: parseIncludePersonal(includePersonal),
      includeVehicles: parseIncludeVehicles(includeVehicles),
    };
    return this.recipes.plan(serverId, list, opts, req.user);
  }

  /** GET — one target's craft tree (`have`/`short` always null). */
  @Get(`${BASE}/:prefab/tree`)
  @Header('Cache-Control', NO_STORE)
  tree(
    @Param('serverId', armoryIdPipe) serverId: number,
    @Param('prefab') prefab: string,
    @Query('quality') quality: unknown,
    @Query('kind') kind: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<ValheimRecipeTreeResponse> {
    const p = parseRecipePrefab(prefab);
    const q = parseTreeQuality(quality);
    const k = parseTreeKind(kind);
    return this.recipes.tree(serverId, p, q, k, req.user);
  }
}
