/**
 * ROK-1627: seeds `process.env.CLIENT_URL` from trusted configuration at boot.
 *
 * Replaces the request-driven middleware that used to write it from the first
 * non-localhost `Host` header. Only anchors the deployer controls are read,
 * and only a value this service itself seeded is ever overwritten.
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SETTING_KEYS } from '../drizzle/schema';
import {
  isUnset,
  resolveSeedClientUrl,
  type ClientUrlAnchors,
} from './client-url.helpers';
import { SettingsService } from './settings.service';
import { SETTINGS_EVENTS } from './settings.types';

@Injectable()
export class ClientUrlSeederService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ClientUrlSeederService.name);
  /** The exact value this service last wrote; anything else is the deployer's. */
  private seededValue: string | null = null;
  private warnedMissing = false;

  constructor(private readonly settings: SettingsService) {}

  /** Seed once the app is up and the settings cache can be read. */
  async onApplicationBootstrap(): Promise<void> {
    await this.seed();
  }

  /**
   * First-run setup configures the Discord callback AFTER boot, so re-resolve
   * whenever it changes.
   */
  @OnEvent(SETTINGS_EVENTS.OAUTH_DISCORD_UPDATED)
  async onDiscordOAuthUpdated(): Promise<void> {
    await this.seed();
  }

  /** Read every trusted anchor. */
  private async readAnchors(): Promise<ClientUrlAnchors> {
    const [settingClientUrl, settingDiscordCallbackUrl] = await Promise.all([
      this.settings.get(SETTING_KEYS.CLIENT_URL),
      this.settings.get(SETTING_KEYS.DISCORD_CALLBACK_URL),
    ]);
    return {
      settingClientUrl,
      settingDiscordCallbackUrl,
      envDiscordCallbackUrl: process.env.DISCORD_CALLBACK_URL,
    };
  }

  /** Write `CLIENT_URL` when it is unset or still holds our own seed. */
  private async seed(): Promise<void> {
    const current = process.env.CLIENT_URL;
    if (!isUnset(current) && current !== this.seededValue) return;
    const resolved = resolveSeedClientUrl(await this.readAnchors());
    if (!resolved) return this.warnMissing();
    if (resolved === current) return;
    process.env.CLIENT_URL = resolved;
    this.seededValue = resolved;
    this.logger.log(`CLIENT_URL seeded from configuration: ${resolved}`);
  }

  /** Tell the deployer once that links will be missing until they act. */
  private warnMissing(): void {
    if (this.warnedMissing) return;
    this.warnedMissing = true;
    this.logger.warn(
      'CLIENT_URL is not set and no configured source (the client_url ' +
        'setting, DISCORD_CALLBACK_URL) could supply it. Set CLIENT_URL to ' +
        'your public site URL. Until then: Discord embeds and DMs omit links ' +
        'where the link cannot be built, and logins plus link previews fall ' +
        'back to the origin each request arrived on.',
    );
  }
}
