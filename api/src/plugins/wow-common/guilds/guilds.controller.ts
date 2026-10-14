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
import {
  DeleteGuildEditorParamsSchema,
  GuildListQuerySchema,
  type CharacterGuild,
  type GuildEditor,
  type GuildEditorList,
  type GuildPage,
  type MyGuilds,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../manifest';
import { GuildEditorsService } from './guild-editors.service';
import { GuildPageService } from './guild-page.service';

const jwt = AuthGuard('jwt');

/**
 * ROK-1785 — `/plugins/wow/guilds`. Thin: access lives in
 * `GuildAccessService` (via the two services), queries in `*.helpers.ts`.
 * `by-character` is public like the character page it decorates; every
 * other route needs a JWT. Literal routes are declared before `:id`.
 */
@Controller('plugins/wow/guilds')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class GuildsController {
  constructor(
    private readonly pages: GuildPageService,
    private readonly editors: GuildEditorsService,
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
  byCharacter(
    @Param('characterId', ParseUUIDPipe) characterId: string,
  ): Promise<CharacterGuild> {
    return this.pages.byCharacter(characterId);
  }

  @Get(':id')
  @UseGuards(jwt)
  page(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildPage> {
    return this.pages.page(req.user, id);
  }

  @Get(':id/editors')
  @UseGuards(jwt)
  listEditors(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildEditorList> {
    return this.editors.list(req.user, id);
  }

  @Post(':id/editors')
  @UseGuards(jwt)
  createEditor(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<GuildEditor> {
    return this.editors.create(req.user, id, body);
  }

  @Delete(':id/editors/:editorId')
  @UseGuards(jwt)
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
