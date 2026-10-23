/**
 * ROK-1893 P1 — hub invite links (§4.1). No class-level guard: the preview
 * is public (optional JWT for the viewer fields). Registered BEFORE
 * `CommunityHubsController` so the literal `hubs/invites/...` paths win.
 *
 * - GET    /hubs/invites/:token          public (+ optional JWT)
 * - POST   /hubs/invites/:token/join     JWT + not deactivated
 * - GET    /hubs/:id/invites             JWT; live member or staff
 * - POST   /hubs/:id/invites             JWT; live member or staff
 * - DELETE /hubs/:id/invites/:inviteId   JWT; maker, Leader/Officer, staff
 */
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
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  CreateHubInviteSchema,
  type HubInvite,
  type HubInviteJoinResponse,
  type HubInviteList,
  type HubInvitePreview,
} from '@raid-ledger/contract';
import { NotDeactivatedGuard } from '../../../auth/not-deactivated.guard';
import { OptionalJwtGuard } from '../../../auth/optional-jwt.guard';
import type { AuthenticatedRequest } from '../../../auth/types';
import { RateLimit } from '../../../throttler/rate-limit.decorator';
import { parseBody } from '../community-proposals.body';
import { HubInviteLandingService } from './hub-invite-landing.service';
import { HubInvitesService } from './hub-invites.service';

const NO_STORE = 'private, no-store';

/** `req.user` under `OptionalJwtGuard` — null when signed out. */
interface MaybeAuthedRequest {
  user?: AuthenticatedRequest['user'] | null;
}

@Controller('hubs')
export class HubInvitesController {
  constructor(
    private readonly invites: HubInvitesService,
    private readonly landing: HubInviteLandingService,
  ) {}

  @Get('invites/:token')
  @UseGuards(OptionalJwtGuard)
  @RateLimit('public')
  @Header('Cache-Control', NO_STORE)
  preview(
    @Param('token') token: string,
    @Req() req: MaybeAuthedRequest,
  ): Promise<HubInvitePreview> {
    return this.landing.preview(token, req.user?.id ?? null);
  }

  @Post('invites/:token/join')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  @RateLimit('auth')
  @HttpCode(HttpStatus.OK)
  join(
    @Param('token') token: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<HubInviteJoinResponse> {
    return this.landing.join(token, req.user.id);
  }

  @Get(':id/invites')
  @UseGuards(AuthGuard('jwt'))
  @Header('Cache-Control', NO_STORE)
  list(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<HubInviteList> {
    return this.invites.list(req.user, id);
  }

  @Post(':id/invites')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  create(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<HubInvite> {
    return this.invites.create(
      req.user,
      id,
      parseBody(CreateHubInviteSchema, body ?? {}),
    );
  }

  @Delete(':id/invites/:inviteId')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('inviteId', ParseIntPipe) inviteId: number,
  ): Promise<void> {
    return this.invites.revoke(req.user, id, inviteId);
  }
}
