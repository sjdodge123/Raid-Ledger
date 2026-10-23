import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  UpdateHubAutoMembershipSchema,
  type HubAutoMembershipMode,
  type HubInviteJoinResponse,
  type HubJoinPromptList,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../auth/types';
import { NotDeactivatedGuard } from '../../auth/not-deactivated.guard';
import { CommunityLeaderGuard } from './community-leader.guard';
import { parseBody } from './community-proposals.body';
import { HubAutoMembershipService } from './hub-auto-membership.service';

const NO_STORE = 'private, no-store';

/**
 * ROK-1893 P1 (§8d) — the hub Leader's auto-membership switch and the signed-in
 * user's "Join <hub>?" / "You joined <hub>" prompts.
 */
@Controller()
@UseGuards(AuthGuard('jwt'))
export class HubAutoMembershipController {
  constructor(private readonly auto: HubAutoMembershipService) {}

  /** Leader (or staff); 400 for a hub that is not a community hub. */
  @Patch('hubs/:id/auto-membership')
  @UseGuards(CommunityLeaderGuard)
  setMode(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<{ mode: HubAutoMembershipMode }> {
    const { mode } = parseBody(UpdateHubAutoMembershipSchema, body);
    return this.auto.setMode(id, mode);
  }

  @Get('users/me/hub-join-prompts')
  @Header('Cache-Control', NO_STORE)
  list(@Request() req: AuthenticatedRequest): Promise<HubJoinPromptList> {
    return this.auto.listMine(req.user.id);
  }

  @Post('users/me/hub-join-prompts/:id/accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(NotDeactivatedGuard)
  accept(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<HubInviteJoinResponse> {
    return this.auto.accept(req.user.id, id);
  }

  @Post('users/me/hub-join-prompts/:id/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  dismiss(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.auto.dismiss(req.user.id, id);
  }
}
