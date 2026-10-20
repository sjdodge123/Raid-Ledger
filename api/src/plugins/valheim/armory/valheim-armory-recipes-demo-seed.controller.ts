import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../../../auth/admin.guard';
import type { AuthenticatedRequest } from '../../../auth/types';
import { DemoModeGuard } from '../../../admin/demo-mode.guard';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { PelicanConfigService } from '../../pelican/pelican-config.service';
import {
  ValheimArmoryContainersDemoSeedController,
  type ContainersFixtureResponse,
} from './valheim-armory-containers-demo-seed.controller';
import {
  DEMO_COPPER_CHEST_KEY,
  RECIPES_DEMO_COUNTS,
  importRecipesDemoSet,
  importRecipesDemoStock,
  mergeRecipesDemoCatalog,
} from './valheim-armory-recipes-demo-seed.helpers';

/** What the seed returns (DEMO_MODE only — not a contract type). */
export interface RecipesFixtureResponse extends ContainersFixtureResponse {
  /** The hub's guild id (`/guilds/:guildId`) — the same value as `hubId`. */
  guildId: number;
  copperChestKey: string;
  counts: typeof RECIPES_DEMO_COUNTS;
}

/**
 * ROK-1854 L5 — DEMO_MODE planner fixture. Runs the ROK-1853 containers
 * seed (worker's Valheim server + hub, catalogue, owner/member users, the
 * merged scan), then: merges the Bronze-chain names into the catalogue,
 * re-imports the scan with one more public chest (40 Copper, no Tin) and
 * imports the vanilla + Bronze recipe set — every write through the real
 * importers. Body `{ worker? }` as the containers seed. Idempotent: a re-run
 * resets the scan, rewrites the set and returns the same ids.
 */
@Controller('admin/test/valheim')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class ValheimArmoryRecipesDemoSeedController {
  private readonly containers: ValheimArmoryContainersDemoSeedController;

  constructor(
    registry: PluginRegistryService,
    pelicanConfig: PelicanConfigService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {
    this.containers = new ValheimArmoryContainersDemoSeedController(
      registry,
      pelicanConfig,
      db,
    );
  }

  @Post('recipes-fixture')
  @HttpCode(HttpStatus.OK)
  async seed(
    @Body() body: unknown,
    @Request() req: AuthenticatedRequest,
  ): Promise<RecipesFixtureResponse> {
    const base = await this.containers.seed(body, req);
    await mergeRecipesDemoCatalog(this.db, base.serverId);
    await importRecipesDemoStock(this.db, base.serverId);
    await importRecipesDemoSet(this.db, base.serverId);
    return {
      ...base,
      guildId: base.hubId,
      guildPageUrl: `/guilds/${base.hubId}#planner`,
      copperChestKey: DEMO_COPPER_CHEST_KEY,
      counts: RECIPES_DEMO_COUNTS,
    };
  }
}
