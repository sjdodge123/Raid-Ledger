import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  linkCookieAttrs,
  readCookie,
} from '../../auth/link-nonce-cookie.helpers';
import { DemoModeGuard } from '../../admin/demo-mode.guard';
import {
  RequirePlugin,
  PluginActiveGuard,
} from '../plugin-host/plugin-active.guard';
import { BnetAccountProbeService } from './bnet-account-probe.service';
import { BNET_PROBE_COOKIE } from './bnet-account-probe.state';

/**
 * ROK-2129: the PUBLIC Battle.net redirect target (a top-level navigation
 * carries no JWT). Safety comes from the signed, purpose-bound, single-use
 * state, the httpOnly binding cookie and a DB admin re-check (spec D6), plus
 * the plugin + DEMO_MODE gates. Always 302s to the fixed admin page — never
 * a 500, never an open redirect. Never logs the code or state.
 */
@Controller('plugins/blizzard/bnet-account-probe')
@RequirePlugin('blizzard')
@UseGuards(PluginActiveGuard, DemoModeGuard)
export class BnetAccountProbeCallbackController {
  constructor(private readonly probe: BnetAccountProbeService) {}

  /** GET /callback — verify, run, persist, clear the cookie, 302. */
  @Get('callback')
  async callback(
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const cookieHash = readCookie(req, BNET_PROBE_COOKIE) ?? undefined;
    const location = await this.probe.handleCallback({ query, cookieHash });
    res.clearCookie(BNET_PROBE_COOKIE, linkCookieAttrs(req));
    res.redirect(302, location);
  }
}
