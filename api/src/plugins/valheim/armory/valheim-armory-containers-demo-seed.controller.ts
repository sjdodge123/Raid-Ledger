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
  DEMO_CHEST_KEYS,
  importDemoContainers,
  upsertContainersFixtureUser,
} from './valheim-armory-containers-demo-seed.helpers';
import {
  ensureArmoryCatalog,
  upsertArmoryProfile,
} from './valheim-armory-demo-seed.helpers';
import { ensureFixtureHubId } from './valheim-armory-map-hub.helpers';

/** What the seed returns (DEMO_MODE only — not a contract type). */
export interface ContainersFixtureResponse {
  serverId: number;
  hubId: number;
  guildPageUrl: string;
  memberUserId: number;
  ownerUserId: number;
  adminUserId: number;
  privateChestKey: string;
  sharedChestKey: string;
}

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
 * ROK-1853 L5 — DEMO_MODE containers fixture: on the worker's Valheim
 * Pelican server + hub (the link/armory seed's), the server catalogue (only
 * when absent), the merged `containers-basic` + `containers-private` scan
 * through the real importer, an owner user who claims (`admin`) the `c1`
 * identity that built the private chest, and a member who claims nothing.
 * Idempotent: a re-run resets the scan and claim, and returns the same ids.
 */
@Controller('admin/test/valheim/armory')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class ValheimArmoryContainersDemoSeedController {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly pelicanConfig: PelicanConfigService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  @Post('seed-containers')
  @HttpCode(HttpStatus.OK)
  async seed(
    @Body() body: unknown,
    @Request() req: AuthenticatedRequest,
  ): Promise<ContainersFixtureResponse> {
    const worker = parseWorker(body);
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
    await importDemoContainers(this.db, serverId);
    const ownerUserId = await this.seedOwner(serverId, worker);
    const hubId = await ensureFixtureHubId(this.db, serverId, valheimGameId);
    return {
      serverId,
      hubId,
      guildPageUrl: `/guilds/${hubId}#materials`,
      memberUserId: await upsertContainersFixtureUser(
        this.db,
        'member',
        worker,
      ),
      ownerUserId,
      adminUserId: req.user.id,
      ...DEMO_CHEST_KEYS,
    };
  }

  /** The owner user + its admin claim on the private chest's builder (`c1`). */
  private async seedOwner(serverId: number, worker: number): Promise<number> {
    const ownerUserId = await upsertContainersFixtureUser(
      this.db,
      'owner',
      worker,
    );
    await upsertArmoryProfile(this.db, serverId, {
      slot: worker,
      key: 'c1',
      claimedBy: ownerUserId,
      withCatalog: false,
      extraRows: false,
    });
    return ownerUserId;
  }
}
