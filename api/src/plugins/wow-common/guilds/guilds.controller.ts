import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { HubVisibleGuard } from '../../../guilds/hub-visible.guard';
import {
  DeleteGuildEditorParamsSchema,
  GuildListQuerySchema,
  type CharacterGuild,
  type GuildEditor,
  type GuildEditorList,
  type GuildPage,
  type GuildRaidsDto,
  type MyGuilds,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../manifest';
import { GuildEditorsService } from '../../../guilds/guild-editors.service';
import { GuildPageService } from './guild-page.service';
import { GuildRaidsService } from './guild-raids.service';

const jwt = AuthGuard('jwt');

/**
 * ROK-1785 — `/plugins/wow/guilds`. Thin: access lives in
 * `GuildAccessService` (via the two services), queries in `*.helpers.ts`.
 * Every route needs a JWT (`by-character` included: rank names are armory-
 * public, but anonymous callers must not enumerate guilds). Literal routes are declared before `:id`.
 */
@Controller('plugins/wow/guilds')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class GuildsController {
  constructor(
    private readonly pages: GuildPageService,
    private readonly editors: GuildEditorsService,
    private readonly raidsSvc: GuildRaidsService,
  ) {}

  @Get()
  @UseGuards(jwt)
  list(
    @Request() req: AuthenticatedRequest,
    @Query() query: unknown,
  ): Promise<MyGuilds> {
    const parsed = GuildListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.pages.listForGame(req.user, parsed.data.gameId);
  }

  @Get('mine')
  @UseGuards(jwt)
  mine(@Request() req: AuthenticatedRequest): Promise<MyGuilds> {
    return this.pages.mine(req.user);
  }

  @Get('by-character/:characterId')
  @UseGuards(jwt)
  byCharacter(
    @Request() req: AuthenticatedRequest,
    @Param('characterId', ParseUUIDPipe) characterId: string,
  ): Promise<CharacterGuild> {
    return this.pages.byCharacter(req.user, characterId);
  }

  @Get(':id')
  @UseGuards(jwt, HubVisibleGuard)
  page(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildPage> {
    return this.pages.page(req.user, id);
  }

  /** ROK-1787 — Raids tab + Overview widgets (members + staff). */
  @Get(':id/raids')
  @UseGuards(jwt, HubVisibleGuard)
  raids(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildRaidsDto> {
    return this.raidsSvc.raids(req.user, id);
  }

  @Get(':id/editors')
  @UseGuards(jwt, HubVisibleGuard)
  listEditors(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildEditorList> {
    return this.editors.list(req.user, id);
  }

  @Post(':id/editors')
  @UseGuards(jwt, HubVisibleGuard)
  createEditor(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<GuildEditor> {
    return this.editors.create(req.user, id, body);
  }

  @Delete(':id/editors/:editorId')
  @UseGuards(jwt, HubVisibleGuard)
  @HttpCode(204)
  async deleteEditor(
    @Request() req: AuthenticatedRequest,
    @Param() params: unknown,
  ): Promise<void> {
    const parsed = DeleteGuildEditorParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    await this.editors.remove(req.user, parsed.data.id, parsed.data.editorId);
  }
}
