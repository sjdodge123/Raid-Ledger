import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  SigninCodePollRequestSchema,
  type SigninCodePollResponseDto,
  type SigninCodeStartResponseDto,
  type TokenResponseDto,
} from '@raid-ledger/contract';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { AuthService } from './auth.service';
import {
  DiscordSigninLinkService,
  INVALID_DISCORD_LINK_MESSAGE,
} from './discord-signin-link.service';
import { issueLinkSession } from './link-session.helpers';
import {
  MagicLinkService,
  INVALID_MAGIC_LINK_MESSAGE,
  type MagicLinkUser,
} from './magic-link.service';
import { RefreshTokenService } from './refresh/refresh-token.service';
import {
  SIGNIN_CODE_POLL_INTERVAL_MS,
  generateDeviceSecret,
} from './signin-code.helpers';
import { SigninCodeStore, type SigninCodeApproval } from './signin-code.store';

/**
 * ROK-2370: sign in on a device that has no Discord app — the page shows a
 * code, the member types it into `/login code:` in Discord and confirms, and
 * the page's poll turns the approval into a session. No JWT guard: the device
 * secret (kept by the page, stored only as a hash) is the polling credential.
 */
@Controller('auth/discord/signin-code')
export class SigninCodeController {
  private readonly logger = new Logger(SigninCodeController.name);

  constructor(
    private readonly store: SigninCodeStore,
    private readonly magicLinkService: MagicLinkService,
    private readonly signinLinkService: DiscordSigninLinkService,
    private readonly authService: AuthService,
    private readonly refreshService: RefreshTokenService,
  ) {}

  /** POST /auth/discord/signin-code — a fresh code + device secret. */
  @RateLimit('signinStart')
  @Post()
  @HttpCode(HttpStatus.OK)
  async start(@Req() req: Request): Promise<SigninCodeStartResponseDto> {
    const deviceSecret = generateDeviceSecret();
    const { code, expiresAt } = await this.store.create(deviceSecret);
    this.logger.log(`signin-code started ip=${ipHash8(req.ip)}`);
    return {
      code,
      deviceSecret,
      expiresAt: expiresAt.toISOString(),
      pollIntervalMs: SIGNIN_CODE_POLL_INTERVAL_MS,
    };
  }

  /**
   * POST /auth/discord/signin-code/poll. JSON only (415 otherwise) — the
   * login-CSRF guard the redeem routes use. An unknown secret reads as
   * `expired` (no oracle). `approved` is handed out once, with the refresh
   * cookie; a failed redeem is the redeem routes' generic 401.
   */
  @RateLimit('signinPoll')
  @Post('poll')
  @HttpCode(HttpStatus.OK)
  async poll(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SigninCodePollResponseDto> {
    if (!req.is('application/json')) {
      throw new UnsupportedMediaTypeException(
        'Content-Type must be application/json',
      );
    }
    const parsed = SigninCodePollRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid poll body');
    const take = await this.store.takeBySecret(parsed.data.deviceSecret);
    if (take.status === 'expired') return { status: 'expired' };
    if (take.status === 'pending') {
      return { status: 'pending', expiresAt: take.expiresAt.toISOString() };
    }
    const session = await this.redeem(take.approval, req, res);
    return { status: 'approved', session };
  }

  private async redeem(
    approval: SigninCodeApproval,
    req: Request,
    res: Response,
  ): Promise<TokenResponseDto> {
    const deps = {
      authService: this.authService,
      refreshService: this.refreshService,
    };
    const existing = approval.kind === 'existing';
    const user: MagicLinkUser = existing
      ? await this.magicLinkService.redeem(approval.token)
      : await this.signinLinkService.redeem(approval.token);
    const session = existing
      ? await issueLinkSession(deps, user, 'magic', MAGIC_MSG, req, res)
      : await issueLinkSession(deps, user, 'discord-link', LINK_MSG, req, res);
    this.logger.log(
      `signin-code redeemed (${approval.kind}) for user ${user.id}`,
    );
    return session;
  }
}

const MAGIC_MSG = INVALID_MAGIC_LINK_MESSAGE;
const LINK_MSG = INVALID_DISCORD_LINK_MESSAGE;

/** First 8 hex of sha256(ip) — enough to correlate, never the address. */
function ipHash8(ip: string | undefined): string {
  return createHash('sha256')
    .update(ip ?? 'unknown')
    .digest('hex')
    .slice(0, 8);
}
