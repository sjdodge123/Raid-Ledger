/**
 * ROK-1597: Microsoft's account capability (connect / refresh / disconnect)
 * over the identity platform v2.0 `common` tenant, plus read (calendar list
 * + `calendarView` busy time). Write (7b-1) is added by the layer that
 * implements it — the registry detects capability structurally, so this
 * adapter routes read but not write until then.
 *
 * The client id + secret are read per call from app settings, so an admin
 * edit applies without a restart. Nothing here logs a token, code or secret.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../../../settings/settings.service';
import type { SettingsCore } from '../../../settings/settings-bot.helpers';
import { getCalendarProviderConfig } from '../../../settings/settings-calendar-sync.helpers';
import {
  MissingScopesError,
  ProviderAuthError,
  ProviderNotConfiguredError,
  TransientError,
} from '../calendar-provider.errors';
import type {
  AuthUrlInput,
  BusyBlock,
  CalendarAccountProvider,
  CalendarCredentials,
  CalendarReadCapability,
  ConnectResult,
  FetchBusyResult,
  OAuthCodeInput,
  OAuthCredentials,
  ProviderCalendar,
  TimeRange,
} from '../calendar-provider.interface';
import { normalizeGraphEvent } from './microsoft-normalize.helpers';
import {
  buildCalendarListUrl,
  buildCalendarViewUrl,
  GRAPH_ACCESS_DENIED,
  readAllGraphPages,
  readCalendarOrSkip,
  toProviderCalendar,
} from './microsoft-read.helpers';
import {
  buildMicrosoftAuthUrl,
  exchangeMicrosoftCode,
  fetchMicrosoftIdentity,
  missingMicrosoftScopes,
  refreshMicrosoftToken,
  type MicrosoftClient,
} from './microsoft-oauth.helpers';

@Injectable()
export class MicrosoftCalendarAdapter
  implements CalendarAccountProvider, CalendarReadCapability
{
  readonly key = 'microsoft' as const;
  private readonly logger = new Logger(MicrosoftCalendarAdapter.name);

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

  /** Every calendar of the user (picker); `isRaidLedger` set by the caller. */
  async listCalendars(
    credentials: CalendarCredentials,
  ): Promise<ProviderCalendar[]> {
    const token = accessTokenOf(credentials);
    const { items } = await readAllGraphPages(token, buildCalendarListUrl());
    return items.flatMap((item) => toProviderCalendar(item) ?? []);
  }

  /**
   * Busy blocks across `calendarIds` (full window). A gone calendar
   * (404/410) goes to `missingCalendarIds` (pruned by the caller); one
   * refused by 403 `ErrorAccessDenied` to `unreadableCalendarIds` (kept).
   * When EVERY requested calendar is refused the fetch fails instead (a
   * zero-block success would wipe the user's busy blocks). Every other
   * error fails the whole fetch.
   */
  async fetchBusy(
    credentials: CalendarCredentials,
    range: TimeRange,
    calendarIds: string[],
  ): Promise<FetchBusyResult> {
    const token = accessTokenOf(credentials);
    const blocks: BusyBlock[] = [];
    const missing: string[] = [];
    const refused: string[] = [];
    let truncated = 0;
    for (const calendarId of calendarIds) {
      const url = buildCalendarViewUrl(calendarId, range);
      const read = await readCalendarOrSkip(readAllGraphPages(token, url));
      if (read === 'missing') missing.push(calendarId);
      else if (read === 'refused') refused.push(calendarId);
      else {
        if (read.truncated) truncated += 1;
        blocks.push(...read.items.flatMap((i) => normalizeGraphEvent(i) ?? []));
      }
    }
    if (truncated > 0) {
      this.logger.warn(
        `Graph read hit the page cap on ${truncated} calendar(s)`,
      );
    }
    assertSomeReadable(calendarIds, refused, missing);
    return busyResult(blocks, missing, refused);
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

/** Microsoft rows hold OAuth credentials; anything else is unusable. */
export function accessTokenOf(credentials: CalendarCredentials): string {
  if (credentials.kind !== 'oauth' || !credentials.accessToken) {
    throw new ProviderAuthError('credentials_kind');
  }
  return credentials.accessToken;
}

/** Every calendar refused (or refused + gone): fail, keep the old blocks. */
function assertSomeReadable(
  requested: string[],
  refused: string[],
  missing: string[],
): void {
  if (
    refused.length > 0 &&
    refused.length + missing.length === requested.length
  ) {
    throw new TransientError(GRAPH_ACCESS_DENIED);
  }
}

/** Only the skip lists that are non-empty are set (exact optional props). */
function busyResult(
  blocks: BusyBlock[],
  missing: string[],
  refused: string[],
): FetchBusyResult {
  return {
    blocks,
    ...(missing.length > 0 ? { missingCalendarIds: missing } : {}),
    ...(refused.length > 0 ? { unreadableCalendarIds: refused } : {}),
  };
}
