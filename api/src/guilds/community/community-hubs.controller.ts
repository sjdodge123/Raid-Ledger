import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  HubBanSchema,
  HubBlurbUpdateSchema,
  HubDirectoryQuerySchema,
  HubLeaderTransferSchema,
  HubMemberRoleUpdateSchema,
  HubStatusUpdateSchema,
  type CommunityHubJoinResponse,
  type GameHubs,
  type GuildSummary,
  type HubBanList,
  type HubDirectoryPage,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../auth/types';
import { GuildEditorGuard } from '../guild-editor.guard';
import { CommunityLeaderGuard } from './community-leader.guard';
import { HubVisibleGuard } from '../hub-visible.guard';
import { parseBody } from './community-proposals.body';
import { CommunityDirectoryService } from './community-directory.service';
import {
  CommunityMembershipService,
  type CommunityMemberRoleResult,
} from './community-membership.service';
import { CommunityModerationService } from './community-moderation.service';

const NO_STORE = 'private, no-store';

/**
 * ROK-1870 L3 — `hubs` directory + community membership routes (§2.3).
 * `hubs/proposals` (L2b) is registered first so its literal path wins.
 * Every `:id` route 404s unless the hub is `game_community` (services).
 */
@Controller('hubs')
@UseGuards(AuthGuard('jwt'))
export class CommunityHubsController {
  constructor(
    private readonly hubDirectory: CommunityDirectoryService,
    private readonly members: CommunityMembershipService,
    private readonly moderation: CommunityModerationService,
  ) {}

  @Get()
  @Header('Cache-Control', NO_STORE)
  directory(
    @Request() req: AuthenticatedRequest,
    @Query() query: unknown,
  ): Promise<HubDirectoryPage> {
    const parsed = parseBody(HubDirectoryQuerySchema, query);
    return this.hubDirectory.list(req.user.id, parsed);
  }

  @Get('by-game/:gameId')
  @Header('Cache-Control', NO_STORE)
  byGame(
    @Request() req: AuthenticatedRequest,
    @Param('gameId', ParseIntPipe) gameId: number,
  ): Promise<GameHubs> {
    return this.hubDirectory.byGame(req.user, gameId);
  }

  @Patch(':id')
  @UseGuards(HubVisibleGuard, GuildEditorGuard)
  updateBlurb(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<GuildSummary> {
    const { blurb } = parseBody(HubBlurbUpdateSchema, body);
    return this.moderation.updateBlurb(id, blurb);
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  @UseGuards(HubVisibleGuard)
  join(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CommunityHubJoinResponse> {
    return this.members.join(req.user, id);
  }

  @Delete(':id/join')
  @UseGuards(HubVisibleGuard)
  leave(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CommunityHubJoinResponse> {
    return this.members.leave(req.user, id);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(HubVisibleGuard, GuildEditorGuard)
  removeMember(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<void> {
    return this.members.remove(req.user, id, userId);
  }

  @Patch(':id/members/:userId/role')
  @UseGuards(HubVisibleGuard, CommunityLeaderGuard)
  setRole(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: unknown,
  ): Promise<CommunityMemberRoleResult> {
    const dto = parseBody(HubMemberRoleUpdateSchema, body);
    return this.members.setRole(req.user, id, userId, dto);
  }

  @Get(':id/bans')
  @Header('Cache-Control', NO_STORE)
  @UseGuards(HubVisibleGuard, GuildEditorGuard)
  listBans(@Param('id', ParseIntPipe) id: number): Promise<HubBanList> {
    return this.moderation.listBans(id);
  }

  @Put(':id/bans/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(HubVisibleGuard, GuildEditorGuard)
  ban(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: unknown,
  ): Promise<void> {
    const dto = parseBody(HubBanSchema, body ?? {});
    return this.moderation.banUser(req.user, id, userId, dto);
  }

  @Delete(':id/bans/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(HubVisibleGuard, GuildEditorGuard)
  unban(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<void> {
    return this.moderation.unbanUser(id, userId);
  }

  @Post(':id/leader')
  @HttpCode(HttpStatus.OK)
  @UseGuards(HubVisibleGuard, CommunityLeaderGuard)
  transferLeader(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<{ leaderUserId: number }> {
    const { userId } = parseBody(HubLeaderTransferSchema, body);
    return this.moderation.transferLeader(req.user, id, userId);
  }

  /** No HubVisibleGuard: a leader of an archived hub gets 403, not 404 (M14). */
  @Patch(':id/status')
  @UseGuards(CommunityLeaderGuard)
  setStatus(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<{ status: 'active' | 'archived' }> {
    const dto = parseBody(HubStatusUpdateSchema, body);
    return this.moderation.setStatus(req.user, id, dto);
  }
}
