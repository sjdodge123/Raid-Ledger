/**
 * DemoTestSigninCodeController — `POST /admin/test/signin-code/approve`
 * (ROK-2370). Stands in for a member tapping "Yes, sign me in" on the
 * `/login code:` confirm card, so Playwright can drive the login page's
 * Discord-app code flow end to end (bots cannot click another bot's buttons).
 *
 * DEMO_MODE only (env + DB flag) and admin-gated like every sibling
 * `admin/test` controller. Approves as an EXISTING user (magic token,
 * `src:'cmd'`). The token is a credential — never logged or returned.
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';
import { AdminGuard } from '../auth/admin.guard';
import { MagicLinkService } from '../auth/magic-link.service';
import { SigninCodeStore } from '../auth/signin-code.store';
import { normaliseSigninCode } from '../auth/signin-code.helpers';
import { COMMAND_LINK_SRC } from '../auth/discord-signin-link.helpers';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';
import { DemoModeGuard } from './demo-mode.guard';

const ApproveBodySchema = z.object({
  code: z.string().min(1).max(32),
  userId: z.number().int().positive(),
});

/** What the fixture answers (never the token). */
export interface SigninCodeApproveResponse {
  approved: true;
  code: string;
  userId: number;
}

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestSigninCodeController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly usersService: UsersService,
    private readonly magicLinkService: MagicLinkService,
    private readonly store: SigninCodeStore,
  ) {}

  private async assertDemoMode(): Promise<void> {
    const on =
      process.env.DEMO_MODE === 'true' &&
      (await this.settingsService.getDemoMode());
    if (!on) throw new ForbiddenException('Only available in DEMO_MODE');
  }

  /** Approve a pending sign-in code as an existing user. */
  @Post('signin-code/approve')
  @HttpCode(HttpStatus.OK)
  async approve(@Body() body: unknown): Promise<SigninCodeApproveResponse> {
    await this.assertDemoMode();
    const parsed = ApproveBodySchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('code and userId required');
    const code = normaliseSigninCode(parsed.data.code);
    if (!code || !(await this.store.findPending(code))) {
      throw new NotFoundException('No pending sign-in code');
    }
    const { userId } = parsed.data;
    const user = await this.usersService.findById(userId);
    const token = user
      ? await this.magicLinkService.generateToken(userId, {
          src: COMMAND_LINK_SRC,
        })
      : null;
    if (!user || !token)
      throw new NotFoundException(`User ${userId} not found`);
    const approval = {
      kind: 'existing' as const,
      token,
      displayName: user.username,
    };
    if (!(await this.store.approve(code, approval))) {
      throw new NotFoundException('No pending sign-in code');
    }
    return { approved: true, code, userId };
  }
}
