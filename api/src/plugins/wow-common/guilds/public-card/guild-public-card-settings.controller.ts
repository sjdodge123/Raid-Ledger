import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  UpdateGuildPublicCardSchema,
  type GuildPublicCardSettings,
} from '@raid-ledger/contract';
import { GuildEditorGuard } from '../../../../guilds/guild-editor.guard';
import { HubVisibleGuard } from '../../../../guilds/hub-visible.guard';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../../manifest';
import { GuildPublicCardService } from './guild-public-card.service';

const jwt = AuthGuard('jwt');

/**
 * ROK-1813 (D3) — `/plugins/wow/guilds/:id/public-card`: read + toggle the
 * opt-in public card. `canEdit` only (`GuildEditorGuard`; the rank-0 GM
 * without an editor grant gets 403 — N1 default). Non-`wow_guild` → 404.
 */
@Controller('plugins/wow/guilds/:id/public-card')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class GuildPublicCardSettingsController {
  constructor(private readonly cards: GuildPublicCardService) {}

  @Get()
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  get(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildPublicCardSettings> {
    return this.cards.getSettings(id);
  }

  /** `PATCH {enabled}` → `{enabled, slug}`. */
  @Patch()
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<GuildPublicCardSettings> {
    const parsed = UpdateGuildPublicCardSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid public card update',
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    return this.cards.setEnabled(id, parsed.data.enabled);
  }
}
