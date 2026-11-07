import {
  Controller,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { GuildBlizzardRosterSyncResult } from '@raid-ledger/contract';
import { GuildEditorGuard } from '../../../guilds/guild-editor.guard';
import { HubVisibleGuard } from '../../../guilds/hub-visible.guard';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../manifest';
import { BlizzardRosterSyncJob } from './blizzard-roster-sync.job';

/**
 * ROK-1928 §C3 — "Sync now" for a WoW: Forever guild's Blizzard roster.
 * Editors only (same guards as the slug PATCH). 403 kill switch, 404 no slug /
 * not a Forever guild, 409 already running, 502 upstream failure.
 */
@Controller('plugins/wow/guilds/:id/blizzard-roster')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class GuildBlizzardRosterSyncController {
  constructor(private readonly job: BlizzardRosterSyncJob) {}

  /** Run the Blizzard roster sync for this guild now. */
  @Post('sync')
  @HttpCode(200)
  @UseGuards(AuthGuard('jwt'), HubVisibleGuard, GuildEditorGuard)
  sync(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildBlizzardRosterSyncResult> {
    return this.job.syncNow(id);
  }
}
