import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  DeleteGuildEditorParamsSchema,
  type GuildEditor,
  type GuildEditorList,
  type GuildPage,
  type GuildProfile,
  type GuildRaidsDto,
} from '@raid-ledger/contract';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedRequest } from '../auth/types';
import { GuildEditorGuard } from './guild-editor.guard';
import { GuildEditorsService } from './guild-editors.service';
import { GuildProfileService } from './guild-profile.service';
import { HubKindActiveGuard } from './hub-kind-active.guard';
import { HubVisibleGuard } from './hub-visible.guard';
import { HubService } from './hub.service';

const jwt = AuthGuard('jwt');

/**
 * ROK-1831 L2a — the kind-agnostic hub routes at `guilds/:id`. The page and
 * raids come from the guild kind's adapter; profile and editors are core.
 * `plugins/wow/guilds/:id/**` stay as aliases. Registered AFTER the literal
 * `guilds/onboarding` and `guilds/mine` controllers; `ParseIntPipe` keeps a
 * non-numeric segment from ever reaching a handler here.
 */
@Controller('guilds/:id')
@UseGuards(HubKindActiveGuard)
export class HubController {
  constructor(
    private readonly hubs: HubService,
    private readonly profiles: GuildProfileService,
    private readonly editors: GuildEditorsService,
  ) {}

  @Get()
  @UseGuards(jwt, HubVisibleGuard)
  page(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildPage> {
    return this.hubs.page(req.user, id);
  }

  @Get('raids')
  @UseGuards(jwt, HubVisibleGuard)
  raids(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildRaidsDto> {
    return this.hubs.raids(req.user, id);
  }

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

  @Get('editors')
  @UseGuards(jwt, HubVisibleGuard)
  listEditors(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildEditorList> {
    return this.editors.list(req.user, id);
  }

  @Post('editors')
  @UseGuards(jwt, HubVisibleGuard)
  createEditor(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<GuildEditor> {
    return this.editors.create(req.user, id, body);
  }

  @Delete('editors/:editorId')
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

  /** Admin only: hide (`{ hidden: true }`) or unhide the hub (L-5). */
  @Patch('hidden')
  @UseGuards(jwt, AdminGuard)
  setHidden(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<{ hidden: boolean }> {
    return this.hubs.setHidden(id, body);
  }
}
