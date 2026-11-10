import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { HubClaimResult, HubClaimStatus } from '@raid-ledger/contract';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../auth/types';
import { HubVisibleGuard } from '../hub-visible.guard';
import { rethrowHubClaim } from './hub-claim.errors';
import { HubClaimService } from './hub-claim.service';

/**
 * ROK-2153 — the core claim routes for every hub. 404 `HUB_CLAIM_UNAVAILABLE`
 * when no active provider serves the hub; a hidden hub is a plain 404 for
 * non-staff (`HubVisibleGuard`). Provider errors map via `HUB_CLAIM_ERROR_STATUS`.
 *
 * `Cache-Control: private, no-store` is set only on success. A route-level
 * `@Header` is applied after guards run, so the guard's hidden-hub 404 would
 * lack it while the service's missing-guild 404 carried it — a header oracle
 * for hidden hub ids (review r2). Every 404 here must be header-identical.
 */
@Controller('guilds/:id/claim')
@UseGuards(AuthGuard('jwt'), HubVisibleGuard)
export class HubClaimController {
  constructor(private readonly claims: HubClaimService) {}

  @Get()
  status(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<HubClaimStatus> {
    return this.claims
      .status(req.user, id)
      .then((body) => noStore(res, body), rethrowHubClaim);
  }

  /** Body `HubClaimRequest`; answers `HubClaimResult`. */
  @Post(':candidateId')
  @HttpCode(200)
  claim(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('candidateId') candidateId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<HubClaimResult> {
    return this.claims
      .claim(req.user, id, candidateId, body)
      .then((result) => noStore(res, result), rethrowHubClaim);
  }
}

/** Marks a successful claim response uncacheable and passes the body through. */
function noStore<T>(res: Response, body: T): T {
  res.setHeader('Cache-Control', 'private, no-store');
  return body;
}
