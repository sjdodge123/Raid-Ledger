/**
 * ROK-1597: Microsoft's account capability (connect / refresh / disconnect)
 * over the identity platform v2.0 `common` tenant, plus read (calendar list
 * + `calendarView` busy time) and write (the dedicated "Raid Ledger"
 * calendar + per-sign-up copies, `microsoft-write.helpers`).
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
  NotFoundError,
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
  CalendarWriteCapability,
  ConnectResult,
  CopyEventInput,
  CopyRef,
  FetchBusyOptions,
  FetchBusyResult,
  OAuthCodeInput,
  OAuthCredentials,
  ProviderCalendar,
  TimeRange,
} from '../calendar-provider.interface';
import { normalizeGraphEvent } from './microsoft-normalize.helpers';
import { resolveCopyIds } from './microsoft-copy-id-fallback.helpers';
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
import {
  deleteMicrosoftCalendar,
  deleteMicrosoftEvent,
  findMicrosoftEventByCopyId,
  findRaidLedgerCalendar,
  getMicrosoftCalendar,
  insertMicrosoftCalendar,
  insertMicrosoftEvent,
  patchMicrosoftEvent,
} from './microsoft-write.helpers';

@Injectable()
export class MicrosoftCalendarAdapter
  implements
    CalendarAccountProvider,
    CalendarReadCapability,
    CalendarWriteCapability
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
   * error fails the whole fetch. The per-event copy-id fallback runs only
   * for `options.copyCalendarIds` (where our copies can be).
   */
  async fetchBusy(
    credentials: CalendarCredentials,
    range: TimeRange,
    calendarIds: string[],
    cursor?: Record<string, string>,
    options?: FetchBusyOptions,
  ): Promise<FetchBusyResult> {
    void cursor;
    const token = accessTokenOf(credentials);
    const copyCals = new Set(options?.copyCalendarIds ?? []);
    const blocks: BusyBlock[] = [];
    const missing: string[] = [];
    const refused: string[] = [];
    let truncated = 0;
    for (const calendarId of calendarIds) {
      const url = buildCalendarViewUrl(calendarId, range);
      const pages = readAllGraphPages(token, url, 'skip');
      const read = await readCalendarOrSkip(pages);
      if (read === 'missing') missing.push(calendarId);
      else if (read === 'refused') refused.push(calendarId);
      else {
        if (read.truncated) truncated += 1;
        const lookup = copyCals.has(calendarId);
        blocks.push(...(await this.busyBlocksOf(token, read.items, lookup)));
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

  /**
   * Known id still there → it. Gone (404/410) or none → adopt a listed
   * "Raid Ledger" calendar, else create (a create conflict adopts too).
   */
  async ensureRaidLedgerCalendar(
    credentials: CalendarCredentials,
    knownId: string | null,
  ): Promise<string> {
    const token = accessTokenOf(credentials);
    if (knownId) {
      const known = await ignoreNotFound(getMicrosoftCalendar(token, knownId));
      if (known) return known;
    }
    const listed = await findRaidLedgerCalendar(token);
    return listed ?? insertMicrosoftCalendar(token);
  }

  /**
   * PATCH the existing copy (NotFound propagates: the caller recreates).
   * With no ref, adopt the copy already carrying this copy id in THIS
   * calendar before inserting, so a retried create never duplicates (M1).
   * `calendarId` may be the `'primary'` alias (main calendar).
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
      return patchMicrosoftEvent(token, calendarId, id, input);
    }
    const found = await findMicrosoftEventByCopyId(
      token,
      calendarId,
      input.copyId,
    );
    const adopted = found
      ? await ignoreNotFound(
          patchMicrosoftEvent(token, calendarId, found.providerEventId, input),
        )
      : null;
    return adopted ?? insertMicrosoftEvent(token, calendarId, input);
  }

  /** A copy already gone (404/410) counts as deleted. */
  async deleteEvent(
    credentials: CalendarCredentials,
    ref: CopyRef,
  ): Promise<void> {
    const token = accessTokenOf(credentials);
    await ignoreNotFound(deleteMicrosoftEvent(token, ref.providerEventId));
  }

  /** Deleting the calendar removes its copies; already gone is fine. */
  async deleteRaidLedgerCalendar(
    credentials: CalendarCredentials,
    calendarId: string,
  ): Promise<void> {
    const token = accessTokenOf(credentials);
    await ignoreNotFound(deleteMicrosoftCalendar(token, calendarId));
  }

  /**
   * Item 4: copy ids via the `$expand` fast path, or the bounded per-event
   * fallback — one log line says which ran (the live-mailbox check). A
   * calendar our copies cannot be in (`lookup` false) never pays it.
   */
  private async busyBlocksOf(
    token: string,
    items: unknown[],
    lookup: boolean,
  ): Promise<BusyBlock[]> {
    if (!lookup) return items.flatMap((i) => normalizeGraphEvent(i) ?? []);
    const read = await resolveCopyIds(token, items);
    if (read.path === 'fallback') {
      this.logger.log(
        `Graph copy-id path=fallback lookups=${read.lookups} capped=${read.capped}`,
      );
    } else if (read.path === 'expand') {
      this.logger.debug('Graph copy-id path=expand');
    }
    return read.items.flatMap((i) => normalizeGraphEvent(i) ?? []);
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

/** Resolve to null on NotFoundError; every other error propagates. */
async function ignoreNotFound<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}
