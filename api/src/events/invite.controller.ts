import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InviteService } from './invite.service';
import type { InviteCodeResolveResponseDto } from '@raid-ledger/contract';

interface AuthenticatedRequest {
  user: { id: number };
}

/**
 * Public + authenticated routes for magic invite links (ROK-263).
 */
@Controller('invite')
export class InviteController {
  constructor(private readonly inviteService: InviteService) {}

  /**
   * Resolve an invite code — public, no auth required.
   * Returns event + slot context for the landing page.
   */
  @Get(':code')
  async resolveInvite(
    @Param('code') code: string,
  ): Promise<InviteCodeResolveResponseDto> {
    return this.inviteService.resolveInvite(code);
  }

  /**
   * Claim an invite code — requires authentication.
   * Smart matching: existing members get normal signup, new users claim PUG slot.
   */
  @Post(':code/claim')
  @UseGuards(AuthGuard('jwt'))
  async claimInvite(
    @Param('code') code: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<{ type: 'signup' | 'claimed'; eventId: number }> {
    return this.inviteService.claimInvite(code, req.user.id);
  }
}
