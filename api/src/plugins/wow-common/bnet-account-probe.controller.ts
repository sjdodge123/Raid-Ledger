import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { BnetProbeStartSchema } from '@raid-ledger/contract';
import type {
  BnetProbeStartResponseDto,
  BnetProbeStateDto,
} from '@raid-ledger/contract';
import { AdminGuard } from '../../auth/admin.guard';
import { linkCookieAttrs } from '../../auth/link-nonce-cookie.helpers';
import type { AuthenticatedRequest } from '../../auth/types';
import { DemoModeGuard } from '../../admin/demo-mode.guard';
import { SIGNED_STATE_TTL_SECONDS } from '../../common/signed-state.helpers';
import {
  RequirePlugin,
  PluginActiveGuard,
} from '../plugin-host/plugin-active.guard';
import { BnetAccountProbeService } from './bnet-account-probe.service';
import { BNET_PROBE_COOKIE } from './bnet-account-probe.state';

/**
 * ROK-2129: admin routes of the DEMO_MODE Battle.net account-link probe.
 * Admin-only, blizzard-plugin-gated, closed unless DEMO_MODE is on in the
 * env AND the DB (`DemoModeGuard`, listed last).
 */
@Controller('admin/plugins/blizzard/bnet-account-probe')
@RequirePlugin('blizzard')
@UseGuards(AuthGuard('jwt'), AdminGuard, PluginActiveGuard, DemoModeGuard)
export class BnetAccountProbeController {
  constructor(private readonly probe: BnetAccountProbeService) {}

  /** GET — the callback URL to register + the last stored result. */
  @Get()
  getState(): Promise<BnetProbeStateDto> {
    return this.probe.getState();
  }

  /** POST /start — `{url}` for the consent screen; sets the binding cookie. */
  @Post('start')
  @HttpCode(200)
  async start(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BnetProbeStartResponseDto> {
    const parsed = BnetProbeStartSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    }
    const region = parsed.data.region ?? 'us';
    const { url, cookieValue } = await this.probe.start(req.user.id, region);
    res.cookie(BNET_PROBE_COOKIE, cookieValue, {
      ...linkCookieAttrs(),
      maxAge: SIGNED_STATE_TTL_SECONDS * 1000,
    });
    return { url };
  }
}
