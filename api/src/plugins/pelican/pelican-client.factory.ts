import { Injectable } from '@nestjs/common';
import { SETTING_KEYS } from '../../drizzle/schema/app-settings';
import { SettingsService } from '../../settings/settings.service';
import { PelicanClient } from './pelican-client';
import { normalisePanelUrl } from './pelican-url.helpers';

/** The stored connection, or `null` when either half is missing/invalid. */
export interface PelicanConnection {
  client: PelicanClient;
  /** Panel host (`host[:port]`) — safe to show and log. */
  host: string;
}

/**
 * Builds a {@link PelicanClient} from the stored panel URL + client key.
 * Reads settings on every call so a saved change applies immediately.
 */
@Injectable()
export class PelicanClientFactory {
  constructor(private readonly settings: SettingsService) {}

  /** The configured client, or `null` when unconfigured. */
  async create(): Promise<PelicanClient | null> {
    return (await this.connect())?.client ?? null;
  }

  /** The normalised panel base URL (console `Origin`), or `null`. Never logged. */
  async panelUrl(): Promise<string | null> {
    const rawUrl = await this.settings.get(SETTING_KEYS.PELICAN_PANEL_URL);
    if (!rawUrl) return null;
    const url = normalisePanelUrl(rawUrl);
    return url.ok ? url.url : null;
  }

  /** The configured client plus its host, or `null` when unconfigured. */
  async connect(): Promise<PelicanConnection | null> {
    const [rawUrl, apiKey] = await Promise.all([
      this.settings.get(SETTING_KEYS.PELICAN_PANEL_URL),
      this.settings.get(SETTING_KEYS.PELICAN_CLIENT_API_KEY),
    ]);
    if (!rawUrl || !apiKey) return null;
    const url = normalisePanelUrl(rawUrl);
    if (!url.ok) return null;
    const client = new PelicanClient({ baseUrl: url.url, apiKey });
    return { client, host: new URL(url.url).host };
  }
}
