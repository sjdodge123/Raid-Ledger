import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ValheimAssignOwnerBodySchema,
  type ValheimClaimEvent,
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
import { ValheimArmoryClaimsService } from './valheim-armory-claims.service';

/**
 * ROK-1835 L3 claim + owner endpoints. Members: any signed-in user (the JWT
 * strategy already refuses deactivated accounts). Responses carry user ids
 * only — a SteamID64 never leaves the server here. No owner release in v1.
 */
@Controller()
@UseGuards(AuthGuard('jwt'), PluginActiveGuard)
@RequirePlugin(VALHEIM_PLUGIN_ID)
export class ValheimArmoryClaimsController {
  constructor(private readonly claims: ValheimArmoryClaimsService) {}

  /** POST — claim an unclaimed character; 409 `already_claimed`. */
  @Post('plugins/valheim/armory/characters/:id/claim')
  @HttpCode(201)
  claim(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<ValheimClaimEvent> {
    return this.claims.claim(id, req.user.id);
  }

  /** PUT — admin assign (`userId`) or unassign (`null`). */
  @Put('admin/plugins/valheim/armory/characters/:id/owner')
  @UseGuards(AdminGuard)
  @RateLimit('admin')
  assign(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<ValheimClaimEvent> {
    const parsed = ValheimAssignOwnerBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid body');
    return this.claims.assign(id, req.user.id, parsed.data.userId);
  }

  /** GET — the character's claim audit trail, newest first. */
  @Get('admin/plugins/valheim/armory/characters/:id/claim-events')
  @UseGuards(AdminGuard)
  @RateLimit('admin')
  async claimEvents(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ValheimClaimEventListResponse> {
    return { data: await this.claims.events(id) };
  }
}
