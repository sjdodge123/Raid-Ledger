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
import { eq } from 'drizzle-orm';
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
  findOtherGameId,
  findValheimGameId,
  seedValheimLinkFixtureRows,
} from '../link/valheim-link-demo-seed.helpers';
import {
  seedArmoryCharacter,
  type ArmoryCharacterFixtureRequest,
} from './valheim-armory-demo-seed.helpers';
import { ARMORY_FIXTURE_KEYS } from './valheim-armory-demo-sheet';

const RequestSchema = z
  .object({
    slot: z
      .number()
      .int()
      .min(0)
      .max(VALHEIM_LINK_FIXTURE_SLOTS - 1),
    key: z.enum(ARMORY_FIXTURE_KEYS),
    claimedBy: z.number().int().positive().nullable(),
    withCatalog: z.boolean(),
    extraRows: z.boolean(),
  })
  .partial()
  .strict();

/** Seed response; `guildId` is null until the 1831 server hub links one. */
export interface ArmoryCharacterFixture {
  characterId: number;
  serverId: number;
  guildId: number | null;
}

function parseRequest(body: unknown): ArmoryCharacterFixtureRequest {
  const parsed = RequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestException(
      'Expected { slot?, key?: "c1"|"c2"|"c3", claimedBy?: userId | null, withCatalog?, extraRows? }',
    );
  }
  const { slot = 0, key = 'c1', claimedBy = null } = parsed.data;
  const { withCatalog = true, extraRows = false } = parsed.data;
  return { slot, key, claimedBy, withCatalog, extraRows };
}

/** `claimedBy` must name a real user — a readable 400, not an FK 500. */
async function assertClaimant(
  db: PostgresJsDatabase<typeof schema>,
  userId: number | null,
): Promise<void> {
  if (userId === null) return;
  const U = schema.users;
  const [hit] = await db
    .select({ id: U.id })
    .from(U)
    .where(eq(U.id, userId))
    .limit(1);
  if (!hit) throw new BadRequestException(`claimedBy: no user ${userId}`);
}

/**
 * ROK-1836 D8 — DEMO_MODE fixture: one keyed Valheim character (`key`
 * c1…c3, claimed by `claimedBy` or unclaimed; `extraRows` adds EAQS rows
 * and a modded prefab) on the slot's Valheim Pelican server, plus the item
 * catalogue and real atlas/icon PNGs unless `withCatalog: false`.
 */
@Controller('admin/test/valheim')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class ValheimArmoryDemoSeedController {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly pelicanConfig: PelicanConfigService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Reset (idempotent per key) that character + the server catalogue. */
  @Post('armory-character')
  @HttpCode(HttpStatus.OK)
  async seed(@Body() body: unknown): Promise<ArmoryCharacterFixture> {
    const req = parseRequest(body);
    await assertClaimant(this.db, req.claimedBy);
    const valheimGameId = await findValheimGameId(this.db);
    if (valheimGameId === null) {
      throw new NotFoundException('No Valheim game — seed games first');
    }
    await ensureValheimDemoPlugins(this.registry, this.pelicanConfig);
    const otherGameId = await findOtherGameId(this.db);
    const { valheimServerId: serverId } = await seedValheimLinkFixtureRows(
      this.db,
      req.slot,
      { valheimGameId, otherGameId },
      new Date(),
    );
    const characterId = await seedArmoryCharacter(this.db, serverId, req);
    return { characterId, serverId, guildId: null };
  }
}
