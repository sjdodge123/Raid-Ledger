/**
 * DemoTestRenderDmEmbedController — DEMO_MODE-only render seam for DM embeds.
 *
 * The companion bot cannot read a DM another bot sends (Discord 50007), so a
 * notification DM's chrome (author line, footer, state colour, buttons) was
 * assertable at unit tier only. This endpoint runs the SAME builder the DM
 * processor runs (`DiscordNotificationEmbedService.buildNotificationEmbed`),
 * with the community name resolved the same way
 * (`discord-notification.processor.ts` `buildAndSendDM`), and returns the
 * rendered embed and button rows as Discord API JSON.
 *
 * Pure render: no DB write, no notification row, no DM send.
 * Smoke test: `tools/test-bot/src/smoke/tests/dm-embed-render.test.ts`.
 */
import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'discord.js';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import { DiscordNotificationEmbedService } from '../notifications/discord-notification-embed.service';
import { RenderDmEmbedSchema } from './demo-test.schemas';
import { parseDemoBody } from './demo-test.utils';

/** Fixed id: the seam renders, it never creates a notification row. */
const RENDER_NOTIFICATION_ID = 'demo-render-dm-embed';

/** Same fallback the DM processor applies when no community name is set. */
const DEFAULT_COMMUNITY_NAME = 'Raid Ledger';

/** The rendered DM, as the Discord API would receive it. */
export interface RenderedDmEmbed {
  communityName: string;
  embed: ReturnType<EmbedBuilder['toJSON']>;
  components: ReturnType<ActionRowBuilder<ButtonBuilder>['toJSON']>[];
}

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestRenderDmEmbedController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly embedService: DiscordNotificationEmbedService,
  ) {}

  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    if (!(await this.settingsService.getDemoMode())) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }

  /** Render a notification DM embed without sending it (DEMO_MODE only). */
  @Post('render-dm-embed')
  @HttpCode(HttpStatus.OK)
  async renderDmEmbed(@Body() body: unknown): Promise<RenderedDmEmbed> {
    await this.assertDemoMode();
    const { payload, ...input } = parseDemoBody(RenderDmEmbedSchema, body);
    const branding = await this.settingsService.getBranding();
    const communityName = branding.communityName ?? DEFAULT_COMMUNITY_NAME;
    const { embed, row, rows } = await this.embedService.buildNotificationEmbed(
      {
        notificationId: RENDER_NOTIFICATION_ID,
        ...input,
        ...(payload !== undefined ? { payload } : {}),
      },
      communityName,
    );
    // Row order mirrors `DiscordBotClientService.sendEmbedDM`: the
    // type-specific extra rows first, the primary row last.
    return {
      communityName,
      embed: embed.toJSON(),
      components: [...(rows ?? []), row].map((r) => r.toJSON()),
    };
  }
}
