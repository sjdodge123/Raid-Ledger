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
  type WowRecentDingsDto,
  type WowRosterInsightsDto,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../manifest';
import { GuildEditorsService } from '../../../guilds/guild-editors.service';
import { HubService } from '../../../guilds/hub.service';
import { GuildPageService } from './guild-page.service';
import { GuildRaidsService } from './guild-raids.service';
import { RosterInsightsService } from './roster-insights/roster-insights.service';
import { RecentDingsService } from './recent-dings/recent-dings.service';

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
    private readonly hubs: HubService,
    private readonly insightsSvc: RosterInsightsService,
    private readonly dingsSvc: RecentDingsService,
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

  /** ROK-1832/1918: same core extras as `guilds/:id` (alias parity). */
  @Get(':id')
  @UseGuards(jwt, HubVisibleGuard)
  async page(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildPage> {
    const page = await this.pages.page(req.user, id);
    return this.hubs.withCoreExtras(req.user, id, page);
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

  /**
   * ROK-1913 — Forever guild widgets (class/level/role/professions). Anyone
   * who can view the hub; professions omitted for visitors. `?mainsOnly=true`
   * drops linked users' alts.
   */
  @Get(':id/roster-insights')
  @UseGuards(jwt, HubVisibleGuard)
  rosterInsights(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Query('mainsOnly') mainsOnly?: string,
  ): Promise<WowRosterInsightsDto> {
    return this.insightsSvc.insights(req.user, id, mainsOnly === 'true');
  }

  /** ROK-1919 — Forever "Recent dings" (last 30 days). Anyone who can view the hub. */
  @Get(':id/recent-dings')
  @UseGuards(jwt, HubVisibleGuard)
  recentDings(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<WowRecentDingsDto> {
    return this.dingsSvc.recentDings(id);
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
