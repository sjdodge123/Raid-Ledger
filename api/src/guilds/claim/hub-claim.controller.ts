import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { HubClaimResult, HubClaimStatus } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../auth/types';
import { HubVisibleGuard } from '../hub-visible.guard';
import { rethrowHubClaim } from './hub-claim.errors';
import { HubClaimService } from './hub-claim.service';

/**
 * ROK-2153 — the core claim routes for every hub. 404 `HUB_CLAIM_UNAVAILABLE`
 * when no active provider serves the hub; a hidden hub is a plain 404 for
 * non-staff (`HubVisibleGuard`). Provider errors map via `HUB_CLAIM_ERROR_STATUS`.
 */
@Controller('guilds/:id/claim')
@UseGuards(AuthGuard('jwt'), HubVisibleGuard)
export class HubClaimController {
  constructor(private readonly claims: HubClaimService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  status(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<HubClaimStatus> {
    return this.claims.status(req.user, id).catch(rethrowHubClaim);
  }

  /** Body `HubClaimRequest`; answers `HubClaimResult`. */
  @Post(':candidateId')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  claim(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('candidateId') candidateId: string,
    @Body() body: unknown,
  ): Promise<HubClaimResult> {
    return this.claims
      .claim(req.user, id, candidateId, body)
      .catch(rethrowHubClaim);
  }
}
