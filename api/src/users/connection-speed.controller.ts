/**
 * ROK-1374 (C1) — the viewer's OWN connection speed: read, write, consent.
 *
 * Self-scoped by construction: every route reads `req.user.id` and none takes
 * a user id. Privacy (AC20): only the four speed values ever persist; revoking
 * consent deletes the datum, not just the permission (E19). The figure is
 * never returned for another user by any endpoint.
 */
import { Body, Controller, Get, Put, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  SetConnectionSpeedSchema,
  SetSpeedTestConsentSchema,
  type ConnectionSpeedDto,
} from '@raid-ledger/contract';
import { NotDeactivatedGuard } from '../auth/not-deactivated.guard';
import type { AuthenticatedRequest } from '../auth/types';
import { parseOrBadRequest } from './users-controller.helpers';
import { ConnectionSpeedService } from './connection-speed.service';

@Controller('users')
@UseGuards(AuthGuard('jwt'))
export class ConnectionSpeedController {
  constructor(private readonly speed: ConnectionSpeedService) {}

  /** Own row only. */
  @Get('me/connection-speed')
  getMine(@Request() req: AuthenticatedRequest): Promise<ConnectionSpeedDto> {
    return this.speed.get(req.user.id);
  }

  /** 403 `SPEED_TEST_CONSENT_REQUIRED` for an ndt7 figure without consent. */
  @Put('me/connection-speed')
  @UseGuards(NotDeactivatedGuard)
  setMine(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<ConnectionSpeedDto> {
    const dto = parseOrBadRequest(SetConnectionSpeedSchema, body);
    return this.speed.setSpeed(req.user.id, dto);
  }

  /** `consent: false` nulls the stamp AND the three speed columns (E19). */
  @Put('me/speed-test-consent')
  setConsent(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<ConnectionSpeedDto> {
    const dto = parseOrBadRequest(SetSpeedTestConsentSchema, body);
    return this.speed.setConsent(req.user.id, dto.consent);
  }
}
