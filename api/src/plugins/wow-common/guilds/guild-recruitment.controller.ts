import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { GuildRecruitmentView } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../../auth/types';
import { HubVisibleGuard } from '../../../guilds/hub-visible.guard';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../manifest';
import { GuildRecruitmentService } from './guild-recruitment.service';

const jwt = AuthGuard('jwt');

/**
 * ROK-1789 (S5 part A) — `/plugins/wow/guilds/:id/recruitment`. Same guard
 * stack as `GuildIngameTextController` minus `GuildEditorGuard`: the write
 * right (editors OR the rank-0 GM, ruling A1) is checked in the service.
 */
@Controller('plugins/wow/guilds/:id/recruitment')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class GuildRecruitmentController {
  constructor(private readonly recruitment: GuildRecruitmentService) {}

  @Get()
  @UseGuards(jwt, HubVisibleGuard)
  get(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GuildRecruitmentView> {
    return this.recruitment.get(req.user, id);
  }

  @Put()
  @UseGuards(jwt, HubVisibleGuard)
  save(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<GuildRecruitmentView> {
    return this.recruitment.put(req.user, id, body);
  }

  @Delete()
  @HttpCode(204)
  @UseGuards(jwt, HubVisibleGuard)
  clear(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.recruitment.remove(req.user, id);
  }
}
