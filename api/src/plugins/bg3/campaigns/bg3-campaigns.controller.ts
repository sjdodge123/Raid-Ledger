import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { z } from 'zod';
import {
  Bg3BindKeyBodySchema,
  Bg3CampaignKeySchema,
  Bg3CreateCampaignBodySchema,
  Bg3DefaultCampaignBodySchema,
  Bg3UpdateCampaignBodySchema,
  type Bg3CampaignSummary,
} from '@raid-ledger/contract';
import type { AuthenticatedExpressRequest } from '../../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { BG3_PLUGIN_ID } from '../bg3.constants';
import { bg3IdPipe } from './bg3-id.pipe';
import { Bg3CampaignsService } from './bg3-campaigns.service';

/** Zod-parse a body or param; 400 with `message` on failure. */
export function parseOr400<S extends z.ZodType>(
  schema: S,
  value: unknown,
  message: string,
): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException(message);
  return parsed.data;
}

/**
 * ROK-1957 §5.4 — campaign create/edit and the caller's key binding +
 * default campaign. Permission rules live in `Bg3CampaignsService`.
 */
@Controller('plugins/bg3')
@UseGuards(AuthGuard('jwt'), PluginActiveGuard)
@RequirePlugin(BG3_PLUGIN_ID)
export class Bg3CampaignsController {
  constructor(private readonly campaigns: Bg3CampaignsService) {}

  @Post('hubs/:hubId/campaigns')
  create(
    @Param('hubId', bg3IdPipe) hubId: number,
    @Body() body: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<Bg3CampaignSummary> {
    const parsed = parseOr400(
      Bg3CreateCampaignBodySchema,
      body,
      'Invalid body',
    );
    return this.campaigns.create(hubId, req.user, parsed);
  }

  @Patch('campaigns/:campaignId')
  update(
    @Param('campaignId', bg3IdPipe) campaignId: number,
    @Body() body: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<Bg3CampaignSummary> {
    const parsed = parseOr400(
      Bg3UpdateCampaignBodySchema,
      body,
      'Invalid body',
    );
    return this.campaigns.update(campaignId, req.user, parsed);
  }

  @Put('me/campaign-keys/:campaignKey')
  @HttpCode(204)
  async bindKey(
    @Param('campaignKey') key: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<void> {
    const k = parseOr400(Bg3CampaignKeySchema, key, 'Invalid campaign key');
    const { campaignId, confirmCrossHub } = parseOr400(
      Bg3BindKeyBodySchema,
      body,
      'Invalid body',
    );
    await this.campaigns.bindKey(
      req.user,
      k,
      campaignId,
      confirmCrossHub ?? false,
    );
  }

  @Delete('me/campaign-keys/:campaignKey')
  @HttpCode(204)
  async unbindKey(
    @Param('campaignKey') key: string,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<void> {
    const k = parseOr400(Bg3CampaignKeySchema, key, 'Invalid campaign key');
    await this.campaigns.unbindKey(req.user, k);
  }

  @Put('me/default-campaign')
  @HttpCode(204)
  async setDefault(
    @Body() body: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<void> {
    const parsed = parseOr400(
      Bg3DefaultCampaignBodySchema,
      body,
      'Invalid body',
    );
    await this.campaigns.setDefault(req.user, parsed.campaignId);
  }
}
