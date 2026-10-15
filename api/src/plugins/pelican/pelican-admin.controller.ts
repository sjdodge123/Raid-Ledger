import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PelicanConfigUpdateSchema } from '@raid-ledger/contract';
import type {
  PelicanConfig,
  PelicanSyncResult,
  PelicanTestResult,
} from '@raid-ledger/contract';
import { AdminGuard } from '../../auth/admin.guard';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../plugin-host/plugin-active.guard';
import { PELICAN_PLUGIN_ID } from './pelican.constants';
import { PelicanConfigService } from './pelican-config.service';
import { PelicanStatusService } from './pelican-status.service';
import { PelicanSyncService } from './pelican-sync.service';
import { toPelicanSyncResult } from './pelican-sync-result.helpers';

/**
 * Pelican admin routes (ROK-121). Admin-only and 403 while the plugin is
 * inactive (`PluginActiveGuard`). The client key is never returned.
 */
@Controller('admin/plugins/pelican')
@UseGuards(AuthGuard('jwt'), AdminGuard, PluginActiveGuard)
@RequirePlugin(PELICAN_PLUGIN_ID)
export class PelicanAdminController {
  constructor(
    private readonly config: PelicanConfigService,
    private readonly sync: PelicanSyncService,
    private readonly status: PelicanStatusService,
  ) {}

  /** GET /admin/plugins/pelican/config — URL and `apiKeySet`. */
  @Get('config')
  getConfig(): Promise<PelicanConfig> {
    return this.config.getConfig();
  }

  /** PUT /admin/plugins/pelican/config — omitted = unchanged, '' = clear. */
  @Put('config')
  @HttpCode(HttpStatus.OK)
  updateConfig(@Body() body: unknown): Promise<PelicanConfig> {
    const parsed = PelicanConfigUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    }
    return this.config.updateConfig(parsed.data);
  }

  /** POST /admin/plugins/pelican/test — tests the stored config; always 200. */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  testConnection(): Promise<PelicanTestResult> {
    return this.config.testConnection();
  }

  /**
   * POST /admin/plugins/pelican/sync — "Sync now" (ROK-1772); always 200.
   * A run already in flight answers `in_progress`. A successful sync is
   * followed by one status poll (ruling Q5).
   */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async syncNow(): Promise<PelicanSyncResult> {
    const outcome = await this.sync.syncServers();
    const status =
      outcome.code === 'ok' ? await this.status.pollStatuses() : null;
    return toPelicanSyncResult(outcome, status);
  }
}
