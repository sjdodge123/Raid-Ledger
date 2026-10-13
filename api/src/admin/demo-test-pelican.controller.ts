import {
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
import { PelicanConfigUpdateSchema } from '@raid-ledger/contract';
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../plugins/pelican/pelican.constants';
import { PelicanConfigService } from '../plugins/pelican/pelican-config.service';
import { DemoModeGuard } from './demo-mode.guard';
import {
  DEMO_PELICAN_API_KEY,
  DEMO_PELICAN_PANEL_URL,
  seedDemoPelicanServers,
  type PelicanSeedResult,
} from './demo-test-pelican.helpers';

/**
 * Pelican fixture endpoint — DEMO_MODE only (ROK-1094 fleet UI test plan).
 * No fake panel exists, so this writes the admin servers table directly.
 */
@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestPelicanController {
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
    await this.registry.ensureInstalled(PELICAN_PLUGIN_ID);
    await this.registry.activate(PELICAN_PLUGIN_ID);
    await this.pelicanConfig.updateConfig(
      PelicanConfigUpdateSchema.parse({
        panelUrl: DEMO_PELICAN_PANEL_URL,
        apiKey: DEMO_PELICAN_API_KEY,
      }),
    );
    const seeded = await seedDemoPelicanServers(this.db, new Date());
    if (!seeded) {
      throw new NotFoundException('No visible game to map — seed games first');
    }
    return seeded;
  }
}
