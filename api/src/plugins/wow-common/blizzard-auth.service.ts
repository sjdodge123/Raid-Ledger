import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SettingsService } from '../../settings/settings.service';
import { SETTINGS_EVENTS } from '../../settings/settings.types';
import { TOKEN_EXPIRY_BUFFER } from './blizzard.constants';

@Injectable()
export class BlizzardAuthService {
  private readonly logger = new Logger(BlizzardAuthService.name);
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private tokenFetchPromise: Promise<string> | null = null;

  constructor(private readonly settingsService: SettingsService) {}

  @OnEvent(SETTINGS_EVENTS.BLIZZARD_UPDATED)
  handleBlizzardConfigUpdate(): void {
    this.accessToken = null;
    this.tokenExpiry = null;
    this.tokenFetchPromise = null;
    this.logger.log('Blizzard config updated — cached token cleared');
  }

  async getAccessToken(region: string): Promise<string> {
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry)
      return this.accessToken;
    if (this.tokenFetchPromise) return this.tokenFetchPromise;
    this.tokenFetchPromise = this.fetchNewToken(region);
    try {
      return await this.tokenFetchPromise;
    } finally {
      this.tokenFetchPromise = null;
    }
  }

  private async fetchNewToken(region: string): Promise<string> {
    const config = await this.settingsService.getBlizzardConfig();
    if (!config) throw new Error('Blizzard API credentials not configured');
    const response = await fetch(`https://${region}.battle.net/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(
        `Failed to get Blizzard access token: ${response.status} ${errorText}`,
      );
      throw new Error(
        `Failed to get Blizzard access token: ${response.statusText}`,
      );
    }
    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.accessToken = data.access_token;
    this.tokenExpiry = new Date(
      Date.now() + (data.expires_in - TOKEN_EXPIRY_BUFFER) * 1000,
    );
    return this.accessToken;
  }
}
