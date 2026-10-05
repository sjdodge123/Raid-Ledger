import { Controller, Get, Logger, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema';
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
  private readonly logger = new Logger(DiscordBotInviteController.name);
  /** Last (ready, saved) mismatch warned about — warn once per distinct pair. */
  private lastMismatchKey: string | null = null;

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * The OAuth2 install URL plus the human-readable permission list it grants.
   *
   * ROK-1702: before the bot's gateway is READY the URL is built from the
   * saved Discord OAuth client id (same Discord application), so a fresh
   * install can invite the bot before it is in any server.
   *
   * @returns `url: null` only when neither the live bot nor the saved OAuth
   *   settings know a client id; the permission labels are always listed so
   *   the admin page can explain what the install will ask for.
   */
  @Get('invite-url')
  async getInviteUrl(): Promise<BotInviteInfo> {
    const clientId = await this.resolveClientId();
    return {
      url: clientId ? buildBotInviteUrl(clientId) : null,
      permissions: REQUIRED_PERMISSIONS.map((p) => p.label),
      clientId,
    };
  }

  /** Ready client id wins; the saved OAuth client id is the fallback (OQ-9a). */
  private async resolveClientId(): Promise<string | null> {
    const ready = this.clientService.getClientId() || null;
    const raw = await this.settingsService.get(SETTING_KEYS.DISCORD_CLIENT_ID);
    const saved = raw?.trim() || null;
    if (ready && saved && ready !== saved) this.warnMismatch(ready, saved);
    return ready ?? saved;
  }

  private warnMismatch(ready: string, saved: string): void {
    const key = `${ready}:${saved}`;
    if (this.lastMismatchKey === key) return;
    this.lastMismatchKey = key;
    this.logger.warn(
      `Bot invite URL uses the connected bot's id ${ready}, not the saved ` +
        `OAuth client id ${saved}: OAuth client id and bot application ` +
        `differ — Discord login and the bot are different applications.`,
    );
  }
}
