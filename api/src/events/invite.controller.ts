import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Request,
  Header,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InviteService } from './invite.service';
import { OgMetaService } from './og-meta.service';
import { InviteCodeClaimSchema } from '@raid-ledger/contract';
import type { InviteCodeResolveResponseDto } from '@raid-ledger/contract';

interface AuthenticatedRequest {
  user: { id: number };
}

/**
 * Public + authenticated routes for magic invite links (ROK-263).
 */
@Controller('invite')
export class InviteController {
  constructor(
    private readonly inviteService: InviteService,
    private readonly ogMetaService: OgMetaService,
  ) {}

  /**
   * Render OG meta tags for social media crawlers (ROK-393).
   * Nginx proxies crawler requests from /i/:code to this endpoint.
   * Must be registered before :code to avoid route shadowing.
   */
  @Get(':code/og')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  async renderOgMeta(@Param('code') code: string): Promise<string> {
    return this.ogMetaService.renderInviteOgHtml(code);
  }

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
   * Optional role override allows user to select their preferred role (ROK-394).
   */
  @Post(':code/claim')
  @UseGuards(AuthGuard('jwt'))
  async claimInvite(
    @Param('code') code: string,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{
    type: 'signup' | 'claimed';
    eventId: number;
    discordServerInviteUrl?: string;
  }> {
    const dto = InviteCodeClaimSchema.parse(body ?? {});
    return this.inviteService.claimInvite(
      code,
      req.user.id,
      dto.role,
      dto.characterId,
    );
  }
}
