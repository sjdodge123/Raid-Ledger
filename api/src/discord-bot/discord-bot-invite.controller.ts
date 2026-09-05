import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { DiscordBotClientService } from './discord-bot-client.service';
import {
  REQUIRED_PERMISSIONS,
  buildBotInviteUrl,
} from './discord-bot-client.helpers';
import type { BotInviteInfo } from '@raid-ledger/contract';

/**
 * ROK-1471 (D4/AC11): the bot install URL, generated from the SAME
 * `REQUIRED_PERMISSIONS` array the permission check reads. Adding a permission
 * changes this URL with no second edit and no hardcoded integer.
 *
 * Its own controller so `discord-bot-settings.controller.ts` stays under the
 * 300-line cap.
 */
@Controller('admin/settings/discord-bot')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DiscordBotInviteController {
  constructor(private readonly clientService: DiscordBotClientService) {}

  /**
   * The OAuth2 install URL plus the human-readable permission list it grants.
   *
   * @returns `url: null` when no client id is known (token unset/invalid); the
   *   permission labels are always listed so the admin page can explain what
   *   the install will ask for.
   */
  @Get('invite-url')
  getInviteUrl(): BotInviteInfo {
    const clientId = this.clientService.getClientId() ?? null;
    return {
      url: clientId ? buildBotInviteUrl(clientId) : null,
      permissions: REQUIRED_PERMISSIONS.map((p) => p.label),
      clientId,
    };
  }
}
