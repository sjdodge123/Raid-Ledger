/**
 * ROK-1598 (spec §2.6, D1): the Apple iCloud adapter over CalDAV.
 *
 * Apple has no OAuth: the account is connected with an email + app-specific
 * password (`connectWithPassword`), so the OAuth methods refuse with
 * `ProviderRequestError('not_oauth')` and `disconnect` is a no-op (Apple has
 * no revoke API). Read = ctag-gated REPORTs (D7); write = deterministic,
 * conditionally PUT copies in a dedicated calendar (D6). Discovery results
 * go through `withDiscovery`; rediscovered credentials reach the optional
 * `CALDAV_CREDENTIAL_PERSISTER` (L4 wires one that knows the row).
 *
 * Nothing here logs a request, header, body, email or password.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ProviderRequestError } from '../calendar-provider.errors';
import type {
  CalendarAccountProvider,
  CalendarCredentials,
  CalendarPasswordCapability,
  CalendarReadCapability,
  CalendarWriteCapability,
  ConnectResult,
  CopyEventInput,
  CopyRef,
  FetchBusyResult,
  OAuthCredentials,
  PasswordConnectResult,
  ProviderCalendar,
  TimeRange,
} from '../calendar-provider.interface';
import { discover, listCollections } from './apple-caldav-client.helpers';
import {
  noopCalDavPersister,
  withDiscovery,
  type CalDavCredentialPersister,
  type CalDavHome,
} from './apple-discovery.helpers';
import { buildCopyIcs } from './apple-ical-write.helpers';
import {
  buildCursor,
  isUnchanged,
  readCalendars,
  toFetchBusyResult,
  toProviderCalendars,
} from './apple-read.helpers';
import {
  copyResourceName,
  deleteCalendar,
  deleteCopy,
  ensureCalendar,
  ignoreGone,
  objectUrl,
  putCopy,
} from './apple-write.helpers';

/** DI token for the persister of rediscovered CalDAV credentials. */
export const CALDAV_CREDENTIAL_PERSISTER = Symbol(
  'CALDAV_CREDENTIAL_PERSISTER',
);

@Injectable()
export class AppleCalendarAdapter
  implements
    CalendarAccountProvider,
    CalendarPasswordCapability,
    CalendarReadCapability,
    CalendarWriteCapability
{
  readonly key = 'apple' as const;
  private readonly logger = new Logger(AppleCalendarAdapter.name);
  private readonly persist: CalDavCredentialPersister;

  constructor(
    @Optional()
    @Inject(CALDAV_CREDENTIAL_PERSISTER)
    persist: CalDavCredentialPersister | null = null,
  ) {
    this.persist = persist ?? noopCalDavPersister;
  }

  isConfigured(): Promise<boolean> {
    return Promise.resolve(true);
  }

  buildAuthUrl(): Promise<string> {
    return Promise.reject(new ProviderRequestError('not_oauth'));
  }

  connect(): Promise<ConnectResult> {
    return Promise.reject(new ProviderRequestError('not_oauth'));
  }

  refresh(): Promise<OAuthCredentials> {
    return Promise.reject(new ProviderRequestError('not_oauth'));
  }

  /** Apple has no revoke API; deleting the row is the disconnect. */
  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  /** Discovery + a Depth-1 listing prove the login reads the home set. */
  async connectWithPassword(input: {
    email: string;
    appPassword: string;
  }): Promise<PasswordConnectResult> {
    const email = input.email.trim();
    const auth = { username: email, appPassword: input.appPassword };
    const found = await discover(auth);
    await listCollections(auth, found.homeSetUrl);
    return {
      credentials: { kind: 'caldav', ...auth, ...found },
      accountSubject: email.toLowerCase(),
      accountLabel: email,
    };
  }

  listCalendars(creds: CalendarCredentials): Promise<ProviderCalendar[]> {
    return this.atHome(creds, async (h) =>
      toProviderCalendars(await listCollections(h.auth, h.homeSetUrl)),
    );
  }

  fetchBusy(
    creds: CalendarCredentials,
    range: TimeRange,
    calendarIds: string[],
    cursor?: Record<string, string>,
  ): Promise<FetchBusyResult> {
    return this.atHome(creds, async (h) => {
      const skips = { count: 0 };
      const cols = await listCollections(h.auth, h.homeSetUrl, skips);
      if (skips.count > 0) {
        this.logger.warn(`Skipped ${skips.count} unusable calendar hrefs`);
      }
      const next = buildCursor(range, calendarIds, cols);
      if (isUnchanged(cursor, next, calendarIds)) {
        return { blocks: [], unchanged: true, cursor: next };
      }
      const out = await readCalendars(h.auth, cols, calendarIds, range);
      if (out.skipped > 0) {
        this.logger.warn(`Skipped ${out.skipped} unreadable calendar objects`);
      }
      return toFetchBusyResult(calendarIds, out, next);
    });
  }

  ensureRaidLedgerCalendar(
    creds: CalendarCredentials,
    knownId: string | null,
  ): Promise<string> {
    return this.atHome(creds, async (h) => {
      const cols = await listCollections(h.auth, h.homeSetUrl);
      return ensureCalendar(h.auth, h.homeSetUrl, cols, knownId);
    });
  }

  upsertEvent(
    creds: CalendarCredentials,
    calendarId: string,
    input: CopyEventInput,
    existing: CopyRef | null,
  ): Promise<CopyRef> {
    const same = existing?.calendarId === calendarId ? existing : null;
    const ref: CopyRef = same ?? {
      calendarId,
      providerEventId: copyResourceName(calendarId, input.copyId),
    };
    const ics = buildCopyIcs(input, new Date());
    return this.atHome(creds, async (h) => {
      const url = objectUrl(h.homeSetUrl, ref);
      const etag = await putCopy(h.auth, url, ics, same);
      const { calendarId: cal, providerEventId } = ref;
      return etag
        ? { calendarId: cal, providerEventId, etag }
        : { calendarId: cal, providerEventId };
    });
  }

  deleteEvent(creds: CalendarCredentials, ref: CopyRef): Promise<void> {
    return ignoreGone(
      this.atHome(creds, (h) =>
        deleteCopy(h.auth, objectUrl(h.homeSetUrl, ref), ref.etag),
      ),
    );
  }

  deleteRaidLedgerCalendar(
    creds: CalendarCredentials,
    calendarId: string,
  ): Promise<void> {
    return ignoreGone(
      this.atHome(creds, (h) =>
        deleteCalendar(h.auth, h.homeSetUrl, calendarId),
      ),
    );
  }

  private atHome<T>(
    creds: CalendarCredentials,
    fn: (home: CalDavHome) => Promise<T>,
  ): Promise<T> {
    return withDiscovery(creds, this.persist, fn);
  }
}
