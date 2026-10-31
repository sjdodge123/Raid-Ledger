/**
 * ROK-1597: Microsoft's account capability (connect / refresh / disconnect)
 * over the identity platform v2.0 `common` tenant. Read (7a-2) and write
 * (7b-1) capabilities are added by the layers that implement them — the
 * registry detects capability structurally, so this account-only adapter
 * routes neither read nor write until then.
 *
 * The client id + secret are read per call from app settings, so an admin
 * edit applies without a restart. Nothing here logs a token, code or secret.
 */
import { Inject, Injectable } from '@nestjs/common';
import { SettingsService } from '../../../settings/settings.service';
import type { SettingsCore } from '../../../settings/settings-bot.helpers';
import { getCalendarProviderConfig } from '../../../settings/settings-calendar-sync.helpers';
import {
  MissingScopesError,
  ProviderNotConfiguredError,
} from '../calendar-provider.errors';
import type {
  AuthUrlInput,
  CalendarAccountProvider,
  CalendarCredentials,
  ConnectResult,
  OAuthCodeInput,
  OAuthCredentials,
} from '../calendar-provider.interface';
import {
  buildMicrosoftAuthUrl,
  exchangeMicrosoftCode,
  fetchMicrosoftIdentity,
  missingMicrosoftScopes,
  refreshMicrosoftToken,
  type MicrosoftClient,
} from './microsoft-oauth.helpers';

@Injectable()
export class MicrosoftCalendarAdapter implements CalendarAccountProvider {
  readonly key = 'microsoft' as const;

  constructor(
    @Inject(SettingsService) private readonly settings: SettingsCore,
  ) {}

  async isConfigured(): Promise<boolean> {
    const config = await getCalendarProviderConfig(this.settings, 'microsoft');
    return Boolean(config.clientId) && config.hasSecret;
  }

  /**
   * `input.redirectUri` is `buildRedirectUris(settings).microsoft`. Every
   * intent asks for the same set: `Calendars.ReadWrite` covers read, the
   * dedicated calendar and the main calendar alike.
   */
  async buildAuthUrl(input: AuthUrlInput): Promise<string> {
    const { clientId } = await this.client();
    return buildMicrosoftAuthUrl({
      clientId,
      redirectUri: input.redirectUri,
      state: input.state,
      codeChallenge: input.codeChallenge,
    });
  }

  /**
   * Exchange the code, then read `/me` for the subject + label. A grant
   * lacking `Calendars.ReadWrite` throws `MissingScopesError` before any
   * identity call; there is no per-grant revoke, so nothing is undone.
   */
  async connect(input: OAuthCodeInput): Promise<ConnectResult> {
    const tokens = await exchangeMicrosoftCode(await this.client(), input);
    const missing = missingMicrosoftScopes(tokens.scopes);
    if (missing.length > 0) throw new MissingScopesError(missing);
    const identity = await fetchMicrosoftIdentity(tokens.accessToken);
    return {
      credentials: {
        kind: 'oauth',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
      },
      accountSubject: identity.id,
      accountLabel: identity.label,
    };
  }

  /**
   * Microsoft rotates refresh tokens: return the new one so
   * `withFreshCredentials` persists it; keep the stored one if omitted.
   */
  async refresh(credentials: OAuthCredentials): Promise<OAuthCredentials> {
    const client = await this.client();
    const next = await refreshMicrosoftToken(client, credentials.refreshToken);
    return {
      kind: 'oauth',
      accessToken: next.accessToken,
      refreshToken: next.refreshToken ?? credentials.refreshToken,
      expiresAt: next.expiresAt,
      scopes: next.scopes.length > 0 ? next.scopes : credentials.scopes,
    };
  }

  /**
   * No-op: v2.0 has no per-grant revoke for delegated tokens, and
   * `/me/revokeSignInSessions` would sign the user out of every app.
   * Deleting the stored tokens is the effective disconnect.
   */
  async disconnect(credentials: CalendarCredentials): Promise<void> {
    void credentials;
    return Promise.resolve();
  }

  private async client(): Promise<MicrosoftClient> {
    const config = await getCalendarProviderConfig(this.settings, 'microsoft', {
      includeSecret: true,
    });
    if (!config.clientId || !config.clientSecret) {
      throw new ProviderNotConfiguredError('microsoft');
    }
    return { clientId: config.clientId, clientSecret: config.clientSecret };
  }
}
