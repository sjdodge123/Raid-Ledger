/**
 * ROK-1592: Google's account capability (connect / refresh / revoke), plan
 * L1 + §3 2b. Read and write land with ROK-1593 / ROK-1596.
 *
 * The client id + secret are read per call from app settings, so an admin
 * edit applies without a restart. Nothing here logs a token, code or secret.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../../../settings/settings.service';
import type { SettingsCore } from '../../../settings/settings-bot.helpers';
import { getCalendarProviderConfig } from '../../../settings/settings-calendar-sync.helpers';
import {
  CalendarProviderError,
  ProviderAuthError,
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
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  MissingScopesError,
  missingGoogleScopes,
  parseGoogleIdToken,
  refreshGoogleToken,
  revokeGoogleToken,
  type GoogleClient,
  type GoogleTokenSet,
} from './google-oauth.helpers';

@Injectable()
export class GoogleCalendarAdapter implements CalendarAccountProvider {
  readonly key = 'google' as const;
  private readonly logger = new Logger(GoogleCalendarAdapter.name);

  constructor(
    @Inject(SettingsService) private readonly settings: SettingsCore,
  ) {}

  async isConfigured(): Promise<boolean> {
    const config = await getCalendarProviderConfig(this.settings, 'google');
    return Boolean(config.clientId) && config.hasSecret;
  }

  /** `input.redirectUri` is `buildRedirectUris(settings).google`. */
  async buildAuthUrl(input: AuthUrlInput): Promise<string> {
    const { clientId } = await this.client();
    return buildGoogleAuthUrl({ clientId, ...input });
  }

  /**
   * Exchange the code. A grant that fails the scope or id_token checks is
   * revoked (best effort) before the error propagates: nothing is stored.
   */
  async connect(input: OAuthCodeInput): Promise<ConnectResult> {
    const client = await this.client();
    const tokens = await exchangeGoogleCode(client, input);
    try {
      return toConnectResult(tokens, client.clientId);
    } catch (err) {
      await this.revokeQuietly(tokens.refreshToken ?? tokens.accessToken);
      throw err;
    }
  }

  /** Google does not rotate refresh tokens; keep the stored one if omitted. */
  async refresh(credentials: OAuthCredentials): Promise<OAuthCredentials> {
    const client = await this.client();
    const next = await refreshGoogleToken(client, credentials.refreshToken);
    return {
      kind: 'oauth',
      accessToken: next.accessToken,
      refreshToken: next.refreshToken ?? credentials.refreshToken,
      expiresAt: next.expiresAt,
      scopes: next.scopes.length > 0 ? next.scopes : credentials.scopes,
    };
  }

  /** Revoke the refresh token (revoking it also ends its access tokens). */
  async disconnect(credentials: CalendarCredentials): Promise<void> {
    if (credentials.kind !== 'oauth') return;
    const token = credentials.refreshToken || credentials.accessToken;
    if (token) await revokeGoogleToken(token);
  }

  private async client(): Promise<GoogleClient> {
    const config = await getCalendarProviderConfig(this.settings, 'google', {
      includeSecret: true,
    });
    if (!config.clientId || !config.clientSecret) {
      throw new ProviderNotConfiguredError('google');
    }
    return { clientId: config.clientId, clientSecret: config.clientSecret };
  }

  private async revokeQuietly(token: string): Promise<void> {
    try {
      await revokeGoogleToken(token);
    } catch (err) {
      const reason =
        err instanceof CalendarProviderError ? err.reason : 'unspecified';
      this.logger.warn(`Revoke of a rejected Google grant failed (${reason})`);
    }
  }
}

function toConnectResult(
  tokens: GoogleTokenSet,
  clientId: string,
): ConnectResult {
  const missing = missingGoogleScopes(tokens.scopes);
  if (missing.length > 0) throw new MissingScopesError(missing);
  if (!tokens.idToken) throw new ProviderAuthError('id_token_missing');
  const identity = parseGoogleIdToken(tokens.idToken, clientId);
  return {
    credentials: {
      kind: 'oauth',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
    },
    accountSubject: identity.sub,
    accountLabel: identity.email,
  };
}
