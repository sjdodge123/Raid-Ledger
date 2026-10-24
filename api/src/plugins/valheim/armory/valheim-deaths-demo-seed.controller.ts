import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import { AdminGuard } from '../../../auth/admin.guard';
import { DemoModeGuard } from '../../../admin/demo-mode.guard';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { PelicanConfigService } from '../../pelican/pelican-config.service';
import { ensureValheimDemoPlugins } from '../link/valheim-link-demo-seed.controller';
import {
  VALHEIM_LINK_FIXTURE_SLOTS,
  findValheimGameId,
} from '../link/valheim-link-demo-seed.helpers';
import { storeDemoBaseMap } from './valheim-armory-map-demo-seed.helpers';
import { DEATHS_FIXTURE_WORLD_UID } from './valheim-deaths-demo-seed.data';
import {
  ensureDeathsUsers,
  resetDeathsServer,
  seedDeathsCast,
  type DeathsFixture,
} from './valheim-deaths-demo-seed.helpers';
import { ensureDeathsHub } from './valheim-deaths-demo-seed.server';
import { seedDeathsPortals } from './valheim-portals-demo-seed.helpers';

const RequestSchema = z
  .object({
    worker: z
      .number()
      .int()
      .min(0)
      .max(VALHEIM_LINK_FIXTURE_SLOTS - 1),
  })
  .partial()
  .strict();

function parseWorker(body: unknown): number {
  const parsed = RequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestException(
      `Expected { worker?: 0..${VALHEIM_LINK_FIXTURE_SLOTS - 1} }`,
    );
  }
  return parsed.data.worker ?? 0;
}

/**
 * ROK-1930 L5 — DEMO_MODE Deaths fixture: the worker's OWN Valheim server hub,
 * reset to two characters with a map each on one world (`top`: 2 Death pins,
 * a non-death pin and a shared pin; `second`: 1 Death pin + a non-death pin),
 * `valheim_player_deaths` rows (5 SteamID-attributed for `top`, 3 NULL-SteamID
 * for `second` → resolved by name, 1 for a name-only player with no profile),
 * a hub member and a non-member visitor, plus (ROK-1946) one portals scan of
 * 5 portals on the world. Re-running a worker resets the
 * characters, maps, deaths and portals; the server, hub and users keep their ids.
 */
@Controller('admin/test/valheim')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class ValheimDeathsDemoSeedController {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly pelicanConfig: PelicanConfigService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  @Post('deaths-fixture')
  @HttpCode(HttpStatus.OK)
  async seed(@Body() body: unknown): Promise<DeathsFixture> {
    const worker = parseWorker(body);
    const gameId = await this.prepare();
    const { serverId, guildId } = await ensureDeathsHub(
      this.db,
      worker,
      gameId,
    );
    await resetDeathsServer(this.db, serverId);
    const baseMapSha256 = await storeDemoBaseMap(this.db, serverId);
    const now = new Date();
    const cast = await seedDeathsCast(this.db, {
      serverId,
      worker,
      baseMapSha256,
      now,
    });
    const portals = await seedDeathsPortals(this.db, serverId, now);
    const users = await ensureDeathsUsers(this.db, worker, guildId);
    return {
      serverId,
      guildId,
      worldUid: DEATHS_FIXTURE_WORLD_UID,
      users,
      ...cast,
      portals,
    };
  }

  /** Find the Valheim game and enable the plugins. */
  private async prepare(): Promise<number> {
    const gameId = await findValheimGameId(this.db);
    if (gameId === null) {
      throw new NotFoundException('No Valheim game — seed games first');
    }
    await ensureValheimDemoPlugins(this.registry, this.pelicanConfig);
    return gameId;
  }
}
