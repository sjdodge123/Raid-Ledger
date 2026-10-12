import type {
  AuthUrlInput,
  BusyBlock,
  CalendarAccountProvider,
  CalendarCredentials,
  CalendarProviderKey,
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
import { ProviderAuthError } from '../calendar-provider.errors';
import { copyIsBusy, copySummary } from '../copy-presentation.helpers';
import {
  FakeCalendarStore,
  type FakeCalendarSeed,
} from './fake-calendar-store';

/**
 * ROK-1592: an in-memory, deterministic calendar provider. Every later
 * calendar story's specs use it, and in DEMO_MODE the registry routes
 * `demo-fake:` connections to it (plan L15) — so it is shipped code, not a
 * spec helper, and holds no secrets: every token is a counter-derived string.
 *
 * Account + write (ROK-1596) + read (ROK-1593); remote state in
 * `fake-calendar-store`. Read returns the store's own written copies, so a
 * write → read spec is a real round-trip.
 */

/** `account_subject` prefix of a fake connection (L15; real subs are numeric). */
export const FAKE_SUBJECT_PREFIX = 'demo-fake:';

/** Scope set a fake grant reports unless the account overrides it. */
export const FAKE_DEFAULT_SCOPES: readonly string[] = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.app.created',
];

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Name of the dedicated calendar `ensureRaidLedgerCalendar` creates. */
export const FAKE_RAID_LEDGER_CALENDAR_NAME = 'Raid Ledger';
/** Copy presentation is shared with the real adapters (F11). */
export {
  BENCH_TITLE_PREFIX,
  TENTATIVE_TITLE_PREFIX,
} from '../copy-presentation.helpers';

/** What a registered authorization code resolves to. */
export interface FakeAccount {
  /** Subject without the prefix (e.g. `alice`). */
  id: string;
  label?: string | null;
  scopes?: readonly string[];
}

export interface FakeCalendarProviderOptions {
  key?: CalendarProviderKey;
  configured?: boolean;
  /** Clock for `expiresAt`; defaults to `Date.now`. */
  now?: () => number;
}

export function isFakeSubject(subject: string): boolean {
  return subject.startsWith(FAKE_SUBJECT_PREFIX);
}

/** One `fetchBusy` call as the fake saw it (ROK-1593). */
export interface FakeFetchBusyCall {
  range: TimeRange;
  calendarIds: string[];
}

export class FakeCalendarProvider
  implements
    CalendarAccountProvider,
    CalendarReadCapability,
    CalendarWriteCapability
{
  readonly key: CalendarProviderKey;
  /** Refresh tokens passed to `disconnect`, in call order. */
  readonly revoked: string[] = [];
  /** The fake user's calendars and copies (write capability). */
  readonly store = new FakeCalendarStore();
  /** `fetchBusy` calls, in order (ROK-1593). */
  readonly fetchBusyCalls: FakeFetchBusyCall[] = [];
  private readonly codes = new Map<string, FakeAccount>();
  private readonly now: () => number;
  private configured: boolean;
  private issued = 0;

  constructor(opts: FakeCalendarProviderOptions = {}) {
    this.key = opts.key ?? 'google';
    this.configured = opts.configured ?? true;
    this.now = opts.now ?? Date.now;
  }

  /** Make `code` exchange to `account`. A code is single-use, like OAuth. */
  registerCode(code: string, account: FakeAccount): void {
    this.codes.set(code, account);
  }

  setConfigured(configured: boolean): void {
    this.configured = configured;
  }

  isConfigured(): Promise<boolean> {
    return Promise.resolve(this.configured);
  }

  buildAuthUrl(input: AuthUrlInput): Promise<string> {
    const url = new URL('https://calendar.fake.invalid/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return Promise.resolve(url.toString());
  }

  connect(input: OAuthCodeInput): Promise<ConnectResult> {
    const account = this.codes.get(input.code);
    if (!account) return Promise.reject(new ProviderAuthError('invalid_grant'));
    this.codes.delete(input.code);
    return Promise.resolve(this.seedConnection(account));
  }

  /**
   * A connection without a code round-trip — the DEMO_MODE seed endpoint's
   * path (L15). Deterministic: the n-th grant gets `fake-*-n` tokens.
   */
  seedConnection(account: FakeAccount): ConnectResult {
    const n = this.nextSerial();
    const subject = `${FAKE_SUBJECT_PREFIX}${account.id}`;
    return {
      credentials: {
        kind: 'oauth',
        accessToken: `fake-access-${n}`,
        refreshToken: `fake-refresh-${account.id}-${n}`,
        expiresAt: this.expiresAt(),
        scopes: [...(account.scopes ?? FAKE_DEFAULT_SCOPES)],
      },
      accountSubject: subject,
      accountLabel: account.label === undefined ? null : account.label,
    };
  }

  refresh(credentials: OAuthCredentials): Promise<OAuthCredentials> {
    if (this.revoked.includes(credentials.refreshToken))
      return Promise.reject(new ProviderAuthError('invalid_grant'));
    return Promise.resolve({
      ...credentials,
      accessToken: `fake-access-${this.nextSerial()}`,
      expiresAt: this.expiresAt(),
    });
  }

  disconnect(credentials: CalendarCredentials): Promise<void> {
    if (credentials.kind === 'oauth')
      this.revoked.push(credentials.refreshToken);
    return Promise.resolve();
  }

  ensureRaidLedgerCalendar(
    _credentials: CalendarCredentials,
    knownId: string | null,
  ): Promise<string> {
    return this.run(() => {
      if (knownId && this.store.hasCalendar(knownId)) return knownId;
      return this.store.createCalendar(FAKE_RAID_LEDGER_CALENDAR_NAME);
    });
  }

  upsertEvent(
    _credentials: CalendarCredentials,
    calendarId: string,
    input: CopyEventInput,
    existing: CopyRef | null,
  ): Promise<CopyRef> {
    return this.run(() => {
      const copy = this.store.upsertCopy(
        calendarId,
        {
          copyId: input.copyId,
          title: copySummary(input),
          description: input.description,
          url: input.url,
          busy: copyIsBusy(input),
          start: input.start,
          end: input.end,
        },
        // No ref → adopt a copy already carrying this id (review M1).
        existing?.providerEventId ??
          this.store.findCopyByCopyId(calendarId, input.copyId)?.id ??
          null,
      );
      return { calendarId, providerEventId: copy.id, etag: copy.etag };
    });
  }

  deleteEvent(_credentials: CalendarCredentials, ref: CopyRef): Promise<void> {
    return this.run(() => {
      this.store.deleteCopy(ref.providerEventId);
    });
  }

  /** A calendar that is already gone counts as deleted. */
  deleteRaidLedgerCalendar(
    _credentials: CalendarCredentials,
    calendarId: string,
  ): Promise<void> {
    return this.run(() => this.store.removeCalendar(calendarId));
  }

  seedCalendars(seeds: readonly FakeCalendarSeed[]): void {
    this.store.seedCalendars(seeds);
  }

  seedBusy(calendarId: string, blocks: readonly BusyBlock[]): void {
    this.store.seedBusy(calendarId, blocks);
  }

  /** The next `fetchBusy` rejects with `err`. */
  failNextFetch(err: Error): void {
    this.store.failNextFetch(err);
  }

  /** Credentials are not checked: any fake grant reads the store. */
  listCalendars(): Promise<ProviderCalendar[]> {
    return Promise.resolve(this.store.listCalendars());
  }

  /** An unknown calendar is skipped into `missingCalendarIds` (as Google). */
  fetchBusy(
    _credentials: CalendarCredentials,
    range: TimeRange,
    calendarIds: string[],
  ): Promise<FetchBusyResult> {
    this.fetchBusyCalls.push({ range, calendarIds: [...calendarIds] });
    try {
      this.store.takeReadFailure();
    } catch (err) {
      return Promise.reject(err as Error);
    }
    const known = calendarIds.filter((id) => this.store.hasCalendar(id));
    const missing = calendarIds.filter((id) => !this.store.hasCalendar(id));
    const blocks = known.flatMap((id) => this.store.busyIn(id, range));
    return Promise.resolve(
      missing.length > 0 ? { blocks, missingCalendarIds: missing } : { blocks },
    );
  }

  /** Every write op: consume a scripted failure, then act. */
  private run<T>(op: () => T): Promise<T> {
    try {
      this.store.takeFailure();
      return Promise.resolve(op());
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }

  private nextSerial(): number {
    this.issued += 1;
    return this.issued;
  }

  private expiresAt(): string {
    return new Date(this.now() + ACCESS_TOKEN_TTL_MS).toISOString();
  }
}
