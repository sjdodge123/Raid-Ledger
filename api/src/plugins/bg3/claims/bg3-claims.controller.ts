import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Bg3ClaimBodySchema, Bg3SlotKeySchema } from '@raid-ledger/contract';
import type { AuthenticatedExpressRequest } from '../../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { BG3_PLUGIN_ID } from '../bg3.constants';
import { parseOr400 } from '../campaigns/bg3-campaigns.controller';
import { bg3IdPipe } from '../campaigns/bg3-id.pipe';
import { Bg3ClaimsService } from './bg3-claims.service';

/** ROK-1957 §5.5 — claim / clear a party slot; both answer 204. */
@Controller('plugins/bg3/campaigns/:campaignId/claims')
@UseGuards(AuthGuard('jwt'), PluginActiveGuard)
@RequirePlugin(BG3_PLUGIN_ID)
export class Bg3ClaimsController {
  constructor(private readonly claims: Bg3ClaimsService) {}

  @Post()
  @HttpCode(204)
  async claim(
    @Param('campaignId', bg3IdPipe) campaignId: number,
    @Body() body: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<void> {
    const { slotKey } = parseOr400(Bg3ClaimBodySchema, body, 'Invalid body');
    await this.claims.claim(campaignId, req.user, slotKey);
  }

  @Delete(':slotKey')
  @HttpCode(204)
  async clear(
    @Param('campaignId', bg3IdPipe) campaignId: number,
    @Param('slotKey') slotKey: string,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<void> {
    const key = parseOr400(Bg3SlotKeySchema, slotKey, 'Invalid slot');
    await this.claims.clear(campaignId, req.user, key);
  }
}
