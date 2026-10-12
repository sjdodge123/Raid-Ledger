/**
 * ROK-1592: Google's account capability (connect / refresh / revoke), plan
 * L1 + §3 2b. ROK-1596 G2: the write capability (dedicated "Raid Ledger"
 * calendar + per-sign-up copies) delegates to `google-write.helpers`.
 * ROK-1593 A3: the read capability (picker + busy time) delegates to
 * `google-calendar-read.helpers`; it never reads titles (§6.4.1).
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
  NotFoundError,
  ProviderAuthError,
  ProviderNotConfiguredError,
} from '../calendar-provider.errors';
import type {
  AuthUrlInput,
  BusyBlock,
  CalendarAccountProvider,
  CalendarCredentials,
  CalendarReadCapability,
  CalendarWriteCapability,
  ConnectResult,
  CopyEventInput,
  CopyRef,
  FetchBusyResult,
  OAuthCodeInput,
  OAuthCredentials,
  ProviderCalendar,
  TimeRange,
} from '../calendar-provider.interface';
import {
  buildCalendarListUrl,
  buildEventsListUrl,
  normalizeGoogleEvent,
  readAllGooglePages,
  readCalendarOrSkip,
  toProviderCalendar,
} from './google-calendar-read.helpers';
import {
  buildGoogleAuthUrl,
  googleScopesFor,
  exchangeGoogleCode,
  MissingScopesError,
  missingGoogleScopes,
  parseGoogleIdToken,
  refreshGoogleToken,
  revokeGoogleToken,
  type GoogleClient,
  type GoogleTokenSet,
} from './google-oauth.helpers';
import {
  deleteGoogleCalendar,
  deleteGoogleEvent,
  findGoogleEventByCopyId,
  getGoogleCalendar,
  insertGoogleCalendar,
  insertGoogleEvent,
  patchGoogleEvent,
} from './google-write.helpers';

@Injectable()
export class GoogleCalendarAdapter
  implements
    CalendarAccountProvider,
    CalendarReadCapability,
    CalendarWriteCapability
{
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
    const scopes = googleScopesFor(input.intent ?? 'connect');
    return buildGoogleAuthUrl({ clientId, ...input, scopes });
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

  /** Calendars the user can at least see busy time of (picker, R1). */
  async listCalendars(
    credentials: CalendarCredentials,
  ): Promise<ProviderCalendar[]> {
    const token = accessTokenOf(credentials);
    const { items } = await readAllGooglePages(token, buildCalendarListUrl);
    return items.flatMap((item) => toProviderCalendar(item) ?? []);
  }

  /**
   * Busy blocks across `calendarIds` (full window, no sync token — plan D4).
   * A gone calendar (404/410) is skipped into `missingCalendarIds` (pruned
   * by the caller); one refused by a policy 403 is skipped into
   * `unreadableCalendarIds` (kept, recorded as `provider_error`). Every
   * other error fails the whole fetch.
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
      const url = (page?: string) =>
        buildEventsListUrl(calendarId, range, page);
      const read = await readCalendarOrSkip(readAllGooglePages(token, url));
      if (read === 'missing') missing.push(calendarId);
      else if (read === 'refused') refused.push(calendarId);
      else {
        if (read.truncated) truncated += 1;
        blocks.push(...normalizeItems(read.items));
      }
    }
    if (truncated > 0) {
      this.logger.warn(
        `Google read hit the page cap on ${truncated} calendar(s)`,
      );
    }
    return busyResult(blocks, missing, refused);
  }

  /** Known id still there → it; gone (404/410) or none → a new calendar. */
  async ensureRaidLedgerCalendar(
    credentials: CalendarCredentials,
    knownId: string | null,
  ): Promise<string> {
    const token = accessTokenOf(credentials);
    if (knownId) {
      const known = await ignoreNotFound(getGoogleCalendar(token, knownId));
      if (known) return known.id;
    }
    return (await insertGoogleCalendar(token)).id;
  }

  /**
   * PATCH the existing copy (NotFound propagates: caller recreates). With no
   * ref, adopt a live copy already carrying this `rlCopyId` in the calendar
   * before inserting — a retried create (timeout, 5xx after Google
   * committed, lost link row) must not leave a second copy (review M1).
   */
  async upsertEvent(
    credentials: CalendarCredentials,
    calendarId: string,
    input: CopyEventInput,
    existing: CopyRef | null,
  ): Promise<CopyRef> {
    const token = accessTokenOf(credentials);
    if (existing) {
      const id = existing.providerEventId;
      return patchGoogleEvent(token, calendarId, id, input);
    }
    const found = await findGoogleEventByCopyId(
      token,
      calendarId,
      input.copyId,
    );
    const adopted = found
      ? await ignoreNotFound(
          patchGoogleEvent(token, calendarId, found.providerEventId, input),
        )
      : null;
    return adopted ?? insertGoogleEvent(token, calendarId, input);
  }

  /** A copy already gone (404/410) counts as deleted. */
  async deleteEvent(
    credentials: CalendarCredentials,
    ref: CopyRef,
  ): Promise<void> {
    const token = accessTokenOf(credentials);
    await ignoreNotFound(
      deleteGoogleEvent(token, ref.calendarId, ref.providerEventId),
    );
  }

  /** Deleting the calendar removes its copies; already gone is fine. */
  async deleteRaidLedgerCalendar(
    credentials: CalendarCredentials,
    calendarId: string,
  ): Promise<void> {
    const token = accessTokenOf(credentials);
    await ignoreNotFound(deleteGoogleCalendar(token, calendarId));
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

/** Google rows hold OAuth credentials; anything else is unusable. */
function accessTokenOf(credentials: CalendarCredentials): string {
  if (credentials.kind !== 'oauth' || !credentials.accessToken) {
    throw new ProviderAuthError('credentials_kind');
  }
  return credentials.accessToken;
}

/** Resolve to null on NotFoundError; every other error propagates. */
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

function normalizeItems(items: readonly unknown[]): BusyBlock[] {
  return items.flatMap((item) => normalizeGoogleEvent(item, null) ?? []);
}

async function ignoreNotFound<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
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
