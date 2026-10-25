import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import type {
  CompanionLinkPollSuccess,
  CompanionLinkPreview,
  CompanionLinkStartResponse,
} from '@raid-ledger/contract';
import { NotDeactivatedGuard } from '../../auth/not-deactivated.guard';
import type { AuthenticatedExpressRequest } from '../../auth/types';
import { CompanionDeviceLinkPollService } from './companion-device-link-poll.service';
import {
  CompanionDeviceLinkService,
  type CompanionLinkDecisionResult,
} from './companion-device-link.service';

/** Codes and tokens in these bodies must never be cached (RFC 6749 §5.1). */
function noStore(res: Response): Response {
  res.setHeader('Cache-Control', 'no-store');
  return res;
}

/**
 * ROK-1955 RFC 8628 device link. `start` and `poll` are public (the app has
 * no session); `preview` and `decision` need the signed-in web user.
 */
@Controller('companion/v1/devices/link')
export class CompanionDeviceLinkController {
  constructor(
    private readonly links: CompanionDeviceLinkService,
    private readonly polls: CompanionDeviceLinkPollService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  start(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CompanionLinkStartResponse> {
    return this.links.start(body, req.ip, noStore(res));
  }

  @Post('poll')
  @HttpCode(HttpStatus.OK)
  poll(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CompanionLinkPollSuccess> {
    return this.polls.poll(body, req.ip, noStore(res));
  }

  /**
   * Approve / deny. An impersonation session is refused (403): approving
   * would mint a credential for the target that outlives the impersonation.
   */
  @Post('decision')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  async decide(
    @Body() body: unknown,
    @Req() req: AuthenticatedExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CompanionLinkDecisionResult> {
    noStore(res);
    if (req.user.impersonatedBy) {
      throw new ForbiddenException('Cannot link a device while impersonating');
    }
    const caller = { userId: req.user.id, ip: req.ip };
    return this.links.decide(caller, body, res);
  }

  /** Preview a pending link. The code is in the body, never the URL path. */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  preview(
    @Body() body: unknown,
    @Req() req: AuthenticatedExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CompanionLinkPreview> {
    const caller = { userId: req.user.id, ip: req.ip };
    return this.links.preview(caller, body, noStore(res));
  }
}
