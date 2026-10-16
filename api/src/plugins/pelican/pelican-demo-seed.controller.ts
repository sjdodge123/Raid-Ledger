import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { PelicanConfigUpdateSchema } from '@raid-ledger/contract';
import { AdminGuard } from '../../auth/admin.guard';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from './pelican.constants';
import { PelicanConfigService } from './pelican-config.service';
import { DemoModeGuard } from '../../admin/demo-mode.guard';
import {
  DEMO_PELICAN_API_KEY,
  DEMO_PELICAN_PANEL_URL,
  seedDemoPelicanServers,
  type PelicanSeedResult,
} from './pelican-demo-seed.helpers';
import {
  deleteQuickPlayFixture,
  isFixtureSlot,
  parseQuickPlayFixtureRequest,
  seedQuickPlayFixture,
  type QuickPlayFixture,
} from './pelican-demo-quick-play-seed.helpers';

/**
 * Pelican fixture endpoint — DEMO_MODE only (ROK-1094 fleet UI test plan).
 * No fake panel exists, so this writes the admin servers table directly.
 */
@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class PelicanDemoSeedController {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly pelicanConfig: PelicanConfigService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Install + activate Pelican, save a fake (unreachable) connection and
   * reset `pelican_servers` to four rows: running+mapped, offline+unmapped,
   * unknown+hidden, missing. Idempotent — re-run to reset.
   */
  @Post('pelican/seed-servers')
  @HttpCode(HttpStatus.OK)
  async seedPelicanServers(): Promise<PelicanSeedResult> {
    await this.ensureDemoPelican();
    const seeded = await seedDemoPelicanServers(this.db, new Date());
    if (!seeded) {
      throw new NotFoundException('No visible game to map — seed games first');
    }
    return seeded;
  }

  /**
   * ROK-1800 Quick Play switch smoke: Pelican active with the fake
   * connection, plus the caller's slot rows (mapped to `gameId`, and
   * unmapped) reset to switch-off. `seed-servers` never touches them.
   */
  @Post('pelican/quick-play-fixture')
  @HttpCode(HttpStatus.OK)
  async seedQuickPlayFixture(@Body() body: unknown): Promise<QuickPlayFixture> {
    const req = parseQuickPlayFixtureRequest(body);
    if (!req) throw new BadRequestException('Expected { slot, gameId }');
    await this.ensureDemoPelican();
    return seedQuickPlayFixture(this.db, req, new Date());
  }

  /** Remove a slot's Quick Play fixture rows (smoke teardown). */
  @Delete('pelican/quick-play-fixture/:slot')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteQuickPlayFixture(
    @Param('slot', ParseIntPipe) slot: number,
  ): Promise<void> {
    if (!isFixtureSlot(slot)) throw new BadRequestException('Unknown slot');
    await deleteQuickPlayFixture(this.db, slot);
  }

  private async ensureDemoPelican(): Promise<void> {
    await this.registry.ensureInstalled(PELICAN_PLUGIN_ID);
    await this.registry.activate(PELICAN_PLUGIN_ID);
    await this.pelicanConfig.updateConfig(
      PelicanConfigUpdateSchema.parse({
        panelUrl: DEMO_PELICAN_PANEL_URL,
        apiKey: DEMO_PELICAN_API_KEY,
      }),
    );
  }
}
