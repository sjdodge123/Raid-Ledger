import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { WowRosterMemberResponseDto } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../../../auth/types';
import { HubVisibleGuard } from '../../../../guilds/hub-visible.guard';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../../manifest';
import { RosterMemberService } from './roster-member.service';

const jwt = AuthGuard('jwt');

/**
 * ROK-2149 — the read-only roster-member page's read, beside the hub page
 * route and guarded the same way (`guilds.controller.ts` `GET :id`).
 */
@Controller('plugins/wow/guilds')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class RosterMemberController {
  constructor(private readonly members: RosterMemberService) {}

  @Get(':id/members/:memberId')
  @UseGuards(jwt, HubVisibleGuard)
  detail(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('memberId', ParseIntPipe) memberId: number,
  ): Promise<WowRosterMemberResponseDto> {
    return this.members.detail(req.user, id, memberId);
  }
}
