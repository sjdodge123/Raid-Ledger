import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import type { ValheimMapFixtureResponse } from '@raid-ledger/contract';
import { AdminGuard } from '../../../auth/admin.guard';
import type { AuthenticatedRequest } from '../../../auth/types';
import { DemoModeGuard } from '../../../admin/demo-mode.guard';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { PelicanConfigService } from '../../pelican/pelican-config.service';
import { ensureValheimDemoPlugins } from '../link/valheim-link-demo-seed.controller';
import {
  VALHEIM_LINK_FIXTURE_SLOTS,
  findOtherGameId,
  findValheimGameId,
  seedValheimLinkFixtureRows,
} from '../link/valheim-link-demo-seed.helpers';
import {
  ensureArmoryCatalog,
  upsertArmoryProfile,
} from './valheim-armory-demo-seed.helpers';
import { ARMORY_MAP_FIXTURE_KEY } from './valheim-armory-demo-sheet';
import { ensureFixtureHubId } from './valheim-armory-map-hub.helpers';
import {
  storeDemoBaseMap,
  upsertDemoMap,
} from './valheim-armory-map-demo-seed.helpers';

const RequestSchema = z
  .object({
    worker: z
      .number()
      .int()
      .min(0)
      .max(VALHEIM_LINK_FIXTURE_SLOTS - 1),
    withBaseMap: z.boolean(),
  })
  .partial()
  .strict();

function parseRequest(body: unknown): { worker: number; withBaseMap: boolean } {
  const parsed = RequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestException(
      `Expected { worker?: 0..${VALHEIM_LINK_FIXTURE_SLOTS - 1}, withBaseMap?: boolean }`,
    );
  }
  const { worker = 0, withBaseMap = true } = parsed.data;
  return { worker, withBaseMap };
}

/**
 * ROK-1837 L3 — DEMO_MODE map fixture: on the worker's Valheim Pelican
 * server (the link/armory seed's), the CALLER's claimed character — its
 * OWN `map` identity, never the ROK-1836 `c1`…`c3`, so neither fixture
 * resets the other's character or nulls the map's `profile_id` — and its
 * map (personal + shared fog, 4 pins) with a generated base-map PNG unless
 * `withBaseMap: false`. The server catalogue is inserted only when absent
 * (never reset). Re-running resets the `map` character and its map in
 * place — same `characterId` / `mapId` per worker (T8), so deep links hold.
 */
@Controller('admin/test/valheim')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class ValheimArmoryMapDemoSeedController {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly pelicanConfig: PelicanConfigService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  @Post('map-fixture')
  @HttpCode(HttpStatus.OK)
  async seed(
    @Body() body: unknown,
    @Request() req: AuthenticatedRequest,
  ): Promise<ValheimMapFixtureResponse> {
    const { worker, withBaseMap } = parseRequest(body);
    const valheimGameId = await findValheimGameId(this.db);
    if (valheimGameId === null) {
      throw new NotFoundException('No Valheim game — seed games first');
    }
    await ensureValheimDemoPlugins(this.registry, this.pelicanConfig);
    const { valheimServerId: serverId } = await seedValheimLinkFixtureRows(
      this.db,
      worker,
      { valheimGameId, otherGameId: await findOtherGameId(this.db) },
      new Date(),
    );
    await ensureArmoryCatalog(this.db, serverId);
    const characterId = await this.seedCharacter(serverId, worker, req.user.id);
    const sha = withBaseMap ? await storeDemoBaseMap(this.db, serverId) : null;
    const mapId = await upsertDemoMap(this.db, serverId, characterId, sha);
    return {
      characterId,
      mapId,
      pelicanServerId: serverId,
      guildId: await ensureFixtureHubId(this.db, serverId, valheimGameId),
    };
  }

  /** The fixture's claimed character, reset in place (no catalogue, no extra rows). */
  private seedCharacter(
    serverId: number,
    worker: number,
    userId: number,
  ): Promise<number> {
    return upsertArmoryProfile(this.db, serverId, {
      slot: worker,
      key: ARMORY_MAP_FIXTURE_KEY,
      claimedBy: userId,
      withCatalog: false,
      extraRows: false,
    });
  }
}
