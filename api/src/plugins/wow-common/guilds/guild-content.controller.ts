import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { HubVisibleGuard } from '../../../guilds/hub-visible.guard';
import type {
  GuildAddon,
  GuildAddonList,
  GuildProfile,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../manifest';
import { GuildAddonsService } from './guild-addons.service';
import { GuildEditorGuard } from '../../../guilds/guild-editor.guard';
import { GuildProfileService } from '../../../guilds/guild-profile.service';

const jwt = AuthGuard('jwt');

/**
 * ROK-1786 — guild content (GM post, rules, links, recommended addons) under
 * `/plugins/wow/guilds/:id`. Reads need `canView` (checked in the services,
 * 403 before 404); every write is behind `GuildEditorGuard` (admin/operator
 * or an explicit `guild_editors` grant). `addons/order` is a PUT, so it never
 * collides with `PATCH addons/:addonId`.
 */
@Controller('plugins/wow/guilds/:id')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class GuildContentController {
  constructor(
    private readonly profiles: GuildProfileService,
    private readonly addons: GuildAddonsService,
  ) {}

  @Get('profile')
  @UseGuards(jwt, HubVisibleGuard)
  getProfile(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildProfile> {
    return this.profiles.get(req.user, id);
  }

  @Patch('profile')
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  updateProfile(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<GuildProfile> {
    return this.profiles.update(req.user, id, body);
  }

  @Get('addons')
  @UseGuards(jwt, HubVisibleGuard)
  listAddons(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildAddonList> {
    return this.addons.list(req.user, id);
  }

  @Post('addons')
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  createAddon(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<GuildAddon> {
    return this.addons.create(req.user, id, body);
  }

  @Put('addons/order')
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  reorderAddons(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<GuildAddonList> {
    return this.addons.reorder(id, body);
  }

  @Patch('addons/:addonId')
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  updateAddon(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('addonId', ParseIntPipe) addonId: number,
    @Body() body: unknown,
  ): Promise<GuildAddon> {
    return this.addons.update(req.user, id, addonId, body);
  }

  @Delete('addons/:addonId')
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  @HttpCode(204)
  async deleteAddon(
    @Param('id', ParseIntPipe) id: number,
    @Param('addonId', ParseIntPipe) addonId: number,
  ): Promise<void> {
    await this.addons.remove(id, addonId);
  }
}
