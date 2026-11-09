import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../../../auth/admin.guard';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import type { ForeverQuestImportReport } from './forever-quest-import.report';
import { ForeverQuestImportService } from './forever-quest-import.service';

/**
 * ROK-2143: WoW: Forever classic quest import admin routes. Admin-only and
 * plugin-gated, like the Forever namespace probe. Manual only — no cron.
 */
@Controller('admin/plugins/blizzard/forever-quests/import')
@RequirePlugin('blizzard')
@UseGuards(AuthGuard('jwt'), AdminGuard, PluginActiveGuard)
export class ForeverQuestImportController {
  constructor(private readonly importer: ForeverQuestImportService) {}

  /** POST — start a background run (202); 403 switch off, 409 unconfigured / running. */
  @Post()
  @HttpCode(202)
  start(): Promise<ForeverQuestImportReport> {
    return this.importer.start();
  }

  /** GET — the running run's report, else the last stored one (`idle` = never ran). */
  @Get()
  getStatus(): Promise<ForeverQuestImportReport> {
    return this.importer.getStatus();
  }
}
