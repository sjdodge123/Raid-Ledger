import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  PelicanConfigSchema,
  PelicanTestResultSchema,
  isValidIanaTimezone,
} from '@raid-ledger/contract';
import type {
  PelicanConfig,
  PelicanConfigUpdate,
  PelicanTestResult,
} from '@raid-ledger/contract';
import {
  SETTING_KEYS,
  type SettingKey,
} from '../../drizzle/schema/app-settings';
import { SettingsService } from '../../settings/settings.service';
import { PelicanClientFactory } from './pelican-client.factory';
import { normalisePanelUrl } from './pelican-url.helpers';
import { pelicanTestMessage } from './pelican-test-messages';

const FALLBACK_TIMEZONE = 'UTC';

/**
 * Pelican admin config (ROK-121). The client key is write-only: reads report
 * `apiKeySet`, and nothing here logs a value — only field names and host.
 */
@Injectable()
export class PelicanConfigService {
  private readonly logger = new Logger(PelicanConfigService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly clients: PelicanClientFactory,
  ) {}

  /** Current config; parsed `.strict()` so a leaked key field throws. */
  async getConfig(): Promise<PelicanConfig> {
    const [panelUrl, apiKey, tz] = await Promise.all([
      this.settings.get(SETTING_KEYS.PELICAN_PANEL_URL),
      this.settings.get(SETTING_KEYS.PELICAN_CLIENT_API_KEY),
      this.readDefaultTimezone(),
    ]);
    return PelicanConfigSchema.parse({
      panelUrl,
      apiKeySet: apiKey !== null && apiKey !== '',
      defaultTimezone: tz.defaultTimezone,
      timezoneInherited: tz.inherited,
    });
  }

  /**
   * The plugin's default timezone (ROK-1096 D8): its own setting, else the
   * community timezone, else UTC. Never reads the client API key.
   */
  async resolveDefaultTimezone(): Promise<string> {
    return (await this.readDefaultTimezone()).defaultTimezone;
  }

  private async readDefaultTimezone(): Promise<{
    defaultTimezone: string;
    inherited: boolean;
  }> {
    const ownTz = await this.settings.get(
      SETTING_KEYS.PELICAN_DEFAULT_TIMEZONE,
    );
    if (ownTz !== null && ownTz !== '') {
      return { defaultTimezone: ownTz, inherited: false };
    }
    return { defaultTimezone: await this.communityTimezone(), inherited: true };
  }

  /** Apply a validated update: omitted = unchanged, `''` = cleared. */
  async updateConfig(dto: PelicanConfigUpdate): Promise<PelicanConfig> {
    const panelUrl = this.normaliseUrl(dto.panelUrl);
    await this.apply(SETTING_KEYS.PELICAN_PANEL_URL, panelUrl);
    await this.apply(SETTING_KEYS.PELICAN_CLIENT_API_KEY, dto.apiKey);
    await this.apply(
      SETTING_KEYS.PELICAN_DEFAULT_TIMEZONE,
      dto.defaultTimezone,
    );
    const fields = Object.keys(dto).join(', ') || 'nothing';
    this.logger.log(`Pelican config updated: ${fields}`);
    return this.getConfig();
  }

  /** Test the STORED config with `GET /api/client?per_page=1`. */
  async testConnection(): Promise<PelicanTestResult> {
    const conn = await this.clients.connect();
    if (conn === null) return this.result(false, 'not_configured');
    const res = await conn.client.listServers({ perPage: 1 });
    if (res.ok) {
      const serverCount = res.data.pagination.total;
      return this.result(true, 'ok', { serverCount });
    }
    const { kind, status, ipNotAllowed } = res.error;
    return this.result(false, kind, {
      host: conn.host,
      ...(status !== undefined ? { status } : {}),
      ...(ipNotAllowed !== undefined ? { ipNotAllowed } : {}),
    });
  }

  private result(
    success: boolean,
    code: PelicanTestResult['code'],
    ctx: Parameters<typeof pelicanTestMessage>[1] = {},
  ): PelicanTestResult {
    return PelicanTestResultSchema.parse({
      success,
      code,
      message: pelicanTestMessage(code, ctx),
      ...(ctx.serverCount !== undefined
        ? { serverCount: ctx.serverCount }
        : {}),
    });
  }

  private normaliseUrl(raw: string | undefined): string | undefined {
    if (raw === undefined || raw === '') return raw;
    const url = normalisePanelUrl(raw);
    if (!url.ok) throw new BadRequestException([url.reason]);
    return url.url;
  }

  private async apply(key: SettingKey, value: string | undefined) {
    if (value === undefined) return;
    if (value === '') await this.settings.delete(key);
    else await this.settings.set(key, value);
  }

  private async communityTimezone(): Promise<string> {
    const tz = await this.settings.get(SETTING_KEYS.DEFAULT_TIMEZONE);
    return tz !== null && isValidIanaTimezone(tz) ? tz : FALLBACK_TIMEZONE;
  }
}
