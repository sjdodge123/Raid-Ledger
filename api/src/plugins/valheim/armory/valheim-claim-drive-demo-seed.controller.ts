import {
  BadRequestException,
  Body,
  ConflictException,
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
import {
  claimDriveSteamId,
  discordIdTaken,
  ensureClaimDriveHub,
  fixtureTag,
  insertClaimDriveUsers,
  resetClaimDriveCharacters,
  type ClaimDriveFixture,
  type ClaimDriveRequest,
} from './valheim-claim-drive-demo-seed.helpers';
import {
  clearClaimDriveSighting,
  insertClaimDriveSighting,
} from './valheim-claim-drive-demo-sighting.helpers';

const RequestSchema = z
  .object({
    worker: z
      .number()
      .int()
      .min(0)
      .max(VALHEIM_LINK_FIXTURE_SLOTS - 1),
    sighting: z.boolean(),
    bDiscordId: z.string().regex(/^\d{17,20}$/),
  })
  .partial()
  .strict();

function parseRequest(body: unknown): ClaimDriveRequest {
  const parsed = RequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestException(
      `Expected { worker?: 0..${VALHEIM_LINK_FIXTURE_SLOTS - 1}, sighting?: boolean, bDiscordId?: snowflake }`,
    );
  }
  const { worker = 0, sighting = false, bDiscordId = null } = parsed.data;
  return { worker, sighting, bDiscordId };
}

/**
 * ROK-1933 L6a — DEMO_MODE claim-drive fixture: the worker's OWN Valheim
 * server hub, reset to one character claimed by a fresh user A and two
 * unclaimed ones (one named exactly like fresh user B's display name), B with
 * no claim. Both users are onboarded hub members with a Discord id (B's is
 * `bDiscordId` when given, so a real account can receive the DM).
 * `sighting: true` also starts a live Quick Play where a Steam-only player has
 * been on B's matching character for 20 min — what one claim-suggest scan
 * (`POST .../claim-suggest-scan`) needs to DM B.
 */
@Controller('admin/test/valheim')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class ValheimClaimDriveDemoSeedController {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly pelicanConfig: PelicanConfigService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  @Post('claim-drive-fixture')
  @HttpCode(HttpStatus.OK)
  async seed(@Body() body: unknown): Promise<ClaimDriveFixture> {
    const req = parseRequest(body);
    const gameId = await this.prepare(req);
    const { serverId, guildId } = await ensureClaimDriveHub(
      this.db,
      req.worker,
      gameId,
    );
    await clearClaimDriveSighting(this.db, req.worker);
    const tag = fixtureTag(req.worker);
    const users = await insertClaimDriveUsers(
      this.db,
      guildId,
      tag,
      req.bDiscordId,
    );
    const characters = await resetClaimDriveCharacters(
      this.db,
      serverId,
      req.worker,
      users,
    );
    const eventId = req.sighting
      ? await this.sighting(
          req.worker,
          serverId,
          gameId,
          users.a.id,
          characters,
        )
      : null;
    return { serverId, guildId, users, characters, eventId };
  }

  /** Refuse a taken `bDiscordId`, find the Valheim game, enable the plugins. */
  private async prepare(req: ClaimDriveRequest): Promise<number> {
    if (req.bDiscordId && (await discordIdTaken(this.db, req.bDiscordId))) {
      throw new ConflictException(
        `bDiscordId ${req.bDiscordId} is already linked to a user`,
      );
    }
    const gameId = await findValheimGameId(this.db);
    if (gameId === null) {
      throw new NotFoundException('No Valheim game — seed games first');
    }
    await ensureValheimDemoPlugins(this.registry, this.pelicanConfig);
    return gameId;
  }

  /** B's matching character, seen on the server in a live Quick Play. */
  private sighting(
    worker: number,
    serverId: number,
    gameId: number,
    creatorId: number,
    characters: ClaimDriveFixture['characters'],
  ): Promise<number> {
    return insertClaimDriveSighting(this.db, {
      worker,
      serverId,
      gameId,
      creatorId,
      steamId: claimDriveSteamId(worker, 1),
      characterName: characters.matching.name,
    });
  }
}
