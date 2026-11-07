import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { GuildSummary } from '@raid-ledger/contract';
import { GuildEditorGuard } from '../../../guilds/guild-editor.guard';
import { HubVisibleGuard } from '../../../guilds/hub-visible.guard';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../manifest';
import { GuildBlizzardRosterService } from './guild-blizzard-roster.service';

/**
 * ROK-1928 A2 — the WoW: Forever guild's Blizzard roster source under
 * `/plugins/wow/guilds/:id/blizzard-roster`. Editors (officers, delegated
 * editors, staff) only — FLAG A-3.
 */
@Controller('plugins/wow/guilds/:id/blizzard-roster')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class GuildBlizzardRosterController {
  constructor(private readonly roster: GuildBlizzardRosterService) {}

  /** `{ guildSlug: string | null }` → the updated hub summary. */
  @Patch()
  @UseGuards(AuthGuard('jwt'), HubVisibleGuard, GuildEditorGuard)
  setSlug(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<GuildSummary> {
    return this.roster.setSlug(id, body);
  }
}
