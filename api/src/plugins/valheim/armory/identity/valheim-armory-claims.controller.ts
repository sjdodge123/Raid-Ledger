import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ValheimAssignOwnerBodySchema,
  type ValheimCharacterSummary,
  type ValheimClaimEventListResponse,
} from '@raid-ledger/contract';
import { AdminGuard } from '../../../../auth/admin.guard';
import type { AuthenticatedExpressRequest } from '../../../../auth/types';
import { RateLimit } from '../../../../throttler/rate-limit.decorator';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../../plugin-host/plugin-active.guard';
import { VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { ValheimArmoryReadService } from '../read/valheim-armory-read.service';
import { armoryIdPipe } from '../valheim-armory-id.pipe';
import { ValheimArmoryClaimsService } from './valheim-armory-claims.service';

/**
 * ROK-1835 L3 claim + owner endpoints. Members: any signed-in user (the JWT
 * strategy already refuses deactivated accounts). Claim and owner changes
 * answer 200 with the updated member summary (spec route table — V6 re-renders
 * the card without a refetch); a SteamID64 never leaves the server here. The
 * claim route rides the global default throttle tier. No owner release in v1.
 */
@Controller()
@UseGuards(AuthGuard('jwt'), PluginActiveGuard)
@RequirePlugin(VALHEIM_PLUGIN_ID)
export class ValheimArmoryClaimsController {
  constructor(
    private readonly claims: ValheimArmoryClaimsService,
    private readonly reads: ValheimArmoryReadService,
  ) {}

  /**
   * POST — claim an unclaimed character; 200 + summary, 409 `already_claimed`,
   * 404 `Guild not found` for non-staff while its hub is hidden (ROK-1856).
   */
  @Post('plugins/valheim/armory/characters/:id/claim')
  @HttpCode(200)
  async claim(
    @Param('id', armoryIdPipe) id: number,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<ValheimCharacterSummary> {
    // ROK-1856: a hidden hub's characters are not claimable by non-staff.
    await this.reads.assertCharacterVisible(id, req.user);
    await this.claims.claim(id, req.user.id);
    return this.reads.summary(id);
  }

  /** PUT — admin assign (`userId`) or unassign (`null`); 200 + summary. */
  @Put('admin/plugins/valheim/armory/characters/:id/owner')
  @UseGuards(AdminGuard)
  @RateLimit('admin')
  async assign(
    @Param('id', armoryIdPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<ValheimCharacterSummary> {
    const parsed = ValheimAssignOwnerBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid body');
    await this.claims.assign(id, req.user.id, parsed.data.userId);
    return this.reads.summary(id);
  }

  /** GET — the character's claim audit trail, newest first. */
  @Get('admin/plugins/valheim/armory/characters/:id/claim-events')
  @UseGuards(AdminGuard)
  @RateLimit('admin')
  async claimEvents(
    @Param('id', armoryIdPipe) id: number,
  ): Promise<ValheimClaimEventListResponse> {
    return { data: await this.claims.events(id) };
  }
}
