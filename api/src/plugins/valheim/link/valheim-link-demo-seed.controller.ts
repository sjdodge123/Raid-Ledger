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
import { PelicanConfigUpdateSchema } from '@raid-ledger/contract';
import { AdminGuard } from '../../../auth/admin.guard';
import { DemoModeGuard } from '../../../admin/demo-mode.guard';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../pelican/pelican.constants';
import { PelicanConfigService } from '../../pelican/pelican-config.service';
import {
  DEMO_PELICAN_API_KEY,
  DEMO_PELICAN_PANEL_URL,
} from '../../pelican/pelican-demo-seed.helpers';
import { VALHEIM_PLUGIN_ID } from '../valheim.constants';
import {
  findOtherGameId,
  findValheimGameId,
  parseValheimLinkFixtureRequest,
  seedValheimLinkFixtureRows,
  type ValheimLinkFixtureRows,
} from './valheim-link-demo-seed.helpers';
import { ValheimLinkTokensService } from './valheim-link-tokens.service';

/** Seed response. `token` is present only with `withToken: true` (DEMO_MODE). */
export interface ValheimLinkFixture extends ValheimLinkFixtureRows {
  /** The body `serverId` the mod sends (= `String(valheimServerId)`). */
  serverId: string;
  token?: string;
}

/**
 * Valheim Link fixture endpoint — DEMO_MODE only (ROK-1833 smoke + fleet
 * test plan). Pelican + Valheim active with the fake Pelican connection, the
 * caller's slot pair (a Valheim row "Ashlands (demo)" + a row on another
 * game) reset to "no token". `withToken` issues one through the real token
 * service and returns its plaintext once, so a test can POST as the mod.
 */
@Controller('admin/test/valheim')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class ValheimLinkDemoSeedController {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly pelicanConfig: PelicanConfigService,
    private readonly tokens: ValheimLinkTokensService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Reset (idempotent) the slot's rows; optionally issue a token. */
  @Post('link-fixture')
  @HttpCode(HttpStatus.OK)
  async seedLinkFixture(@Body() body: unknown): Promise<ValheimLinkFixture> {
    const req = parseValheimLinkFixtureRequest(body);
    if (!req) throw new BadRequestException('Expected { slot?, withToken? }');
    const valheimGameId = await findValheimGameId(this.db);
    if (valheimGameId === null) {
      throw new NotFoundException('No Valheim game — seed games first');
    }
    await this.ensureDemoPlugins();
    const otherGameId = await findOtherGameId(this.db);
    const rows = await seedValheimLinkFixtureRows(
      this.db,
      req.slot,
      { valheimGameId, otherGameId },
      new Date(),
    );
    const serverId = String(rows.valheimServerId);
    if (!req.withToken) return { ...rows, serverId };
    const issued = await this.tokens.issue(rows.valheimServerId, null, true);
    return { ...rows, serverId: issued.serverId, token: issued.token };
  }

  /** Valheim depends on Pelican, so Pelican (and its fake config) goes first. */
  private async ensureDemoPlugins(): Promise<void> {
    await this.registry.ensureInstalled(PELICAN_PLUGIN_ID);
    await this.registry.activate(PELICAN_PLUGIN_ID);
    await this.pelicanConfig.updateConfig(
      PelicanConfigUpdateSchema.parse({
        panelUrl: DEMO_PELICAN_PANEL_URL,
        apiKey: DEMO_PELICAN_API_KEY,
      }),
    );
    await this.registry.ensureInstalled(VALHEIM_PLUGIN_ID);
    await this.registry.activate(VALHEIM_PLUGIN_ID);
  }
}
