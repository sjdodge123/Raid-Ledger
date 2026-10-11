/**
 * Share-link endpoints for private standalone polls (ROK-1750).
 *
 * A separate controller because `StandalonePollController` carries a
 * class-level JWT guard and the preview must work signed out.
 *
 * - GET  /scheduling-polls/share/:token       — un-authed, `public` tier
 * - POST /scheduling-polls/share/:token/join  — JWT + not-deactivated, `auth` tier
 */
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type {
  PollShareJoinResponseDto,
  PollSharePreviewDto,
} from '@raid-ledger/contract';
import { NotDeactivatedGuard } from '../../auth/not-deactivated.guard';
import type { AuthenticatedRequest } from '../../auth/types';
import { isOperatorOrAdmin } from '../../events/controller.helpers';
import { RateLimit } from '../../throttler/rate-limit.decorator';
import { StandalonePollShareService } from './standalone-poll-share.service';

@Controller('scheduling-polls/share')
export class StandalonePollShareController {
  constructor(private readonly service: StandalonePollShareService) {}

  /** Minimal landing-card preview; one 404 for unknown/malformed/reset. */
  @Get(':token')
  @RateLimit('public')
  async preview(@Param('token') token: string): Promise<PollSharePreviewDto> {
    return this.service.preview(token);
  }

  /** Redeem the link: the caller becomes an invitee (+ member while open). */
  @Post(':token/join')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  @RateLimit('auth')
  @HttpCode(HttpStatus.OK)
  async join(
    @Param('token') token: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<PollShareJoinResponseDto> {
    return this.service.join(token, {
      id: req.user.id,
      isAdmin: isOperatorOrAdmin(req.user.role),
    });
  }
}
