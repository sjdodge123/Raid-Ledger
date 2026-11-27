/**
 * ROK-2371 D1(a): the `/auth/first-time` choice screen's API.
 * - `GET /auth/first-time` → `PendingIdentityViewDto` (no subject, no email).
 * - `POST /auth/first-time/create` → JSON-only (415 otherwise), spends the
 *   pending record, creates the account and signs in. The pending cookie is
 *   the CSRF proof (httpOnly, SameSite=Lax, browser-bound).
 */
import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Req,
  Res,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { PendingIdentityViewDto } from '@raid-ledger/contract';
import { RateLimit } from '../../throttler/rate-limit.decorator';
import { AuthService } from '../auth.service';
import { GoogleSigninService, type UserRow } from './google-signin.service';
import { withParkedInvite } from './discord-pending-identity.helpers';
import {
  PendingIdentityStore,
  type PendingIdentity,
} from './pending-identity.store';

const EXPIRED = 'That sign-in expired. Start again from the login page.';

@Controller('auth/first-time')
export class FirstTimeController {
  constructor(
    private readonly svc: GoogleSigninService,
    private readonly pending: PendingIdentityStore,
    private readonly authService: AuthService,
  ) {}

  @RateLimit('auth')
  @Get()
  async view(@Req() req: Request): Promise<PendingIdentityViewDto> {
    const parked = await this.pending.peek(req);
    if (!parked) throw new NotFoundException(EXPIRED);
    return {
      provider: parked.provider,
      displayName: parked.displayName,
      otherMethod: parked.provider === 'google' ? 'discord' : 'google',
    };
  }

  @RateLimit('auth')
  @Post('create')
  @HttpCode(200)
  async create(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ redirect: string }> {
    if (!req.is('application/json')) throw new UnsupportedMediaTypeException();
    if (!(await this.svc.isEnabled())) throw new NotFoundException();
    const parked = await this.pending.consume(req, res);
    if (!parked) throw new NotFoundException(EXPIRED);
    const user = await this.createFor(parked);
    const method = parked.provider === 'google' ? 'google' : 'discord';
    const landing = await this.svc.issueSession(req, res, user, method);
    return { redirect: withParkedInvite(landing, parked) };
  }

  /**
   * Google → a fresh `discord_id NULL` user (409 if the `sub` got linked
   * meanwhile). Discord → exactly today's Discord sign-in path (ban/kick
   * checks, `unlinked:` relink, create).
   */
  private async createFor(parked: PendingIdentity): Promise<UserRow> {
    if (parked.provider === 'google') return this.svc.createGoogleUser(parked);
    const user = await this.authService.validateDiscordUser(
      parked.subject,
      parked.displayName,
      parked.avatar,
    );
    if (!user) throw new NotFoundException(EXPIRED);
    return user;
  }
}
