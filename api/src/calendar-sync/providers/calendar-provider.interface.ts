/**
 * ROK-1592 (epic ROK-669, spec §4.1, plan L1): the calendar provider
 * contract, split by capability. Write ships first, so no adapter has a read
 * or write body yet; stub methods that throw would ship dead code and fail a
 * conformance suite. Each capability is therefore its own interface and the
 * full `CalendarProvider` is their intersection.
 *
 * - `CalendarAccountProvider` — connect / refresh / revoke (ROK-1592).
 * - `CalendarReadCapability` — calendars + busy blocks (ROK-1593).
 * - `CalendarWriteCapability` — Raid Ledger copies (ROK-1596).
 *
 * §4.1's `onCredentialsRefreshed` callback is replaced by an explicit
 * `refresh()` plus `withFreshCredentials()` in `calendar-credentials.helpers`.
 * Credentials are stored as `encrypt(JSON.stringify(CalendarCredentials))`
 * and are decrypted only inside that helper.
 */
import type { CalendarProvider as CalendarProviderId } from '@raid-ledger/contract';

/** Provider id stored in `calendar_connections.provider`. */
export type CalendarProviderKey = CalendarProviderId;

/** OAuth tokens (Google, Microsoft). `expiresAt` is an ISO-8601 instant. */
export interface OAuthCredentials {
  kind: 'oauth';
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  /** Scopes the provider reported as granted. */
  scopes: string[];
}

/** CalDAV login (Apple, ROK-1598). The password is an app-specific one. */
export interface CalDavCredentials {
  kind: 'caldav';
  username: string;
  appPassword: string;
  principalUrl?: string;
  homeSetUrl?: string;
}

/** The decrypted JSON held in `credentials_encrypted`. */
export type CalendarCredentials = OAuthCredentials | CalDavCredentials;

/**
 * Tokens returned by a code exchange. `refreshToken` is null when the
 * provider omits it on re-consent; the connect service then keeps the stored
 * one (plan L8).
 */
export type OAuthTokenGrant = Omit<OAuthCredentials, 'refreshToken'> & {
  refreshToken: string | null;
};

/** What the start route hands an adapter to build the consent URL. */
export interface AuthUrlInput {
  /** Signed OAuth state (`signed-state.helpers`). */
  state: string;
  /** base64url(sha256(verifier)); the method is always S256. */
  codeChallenge: string;
  /** Exact callback URL; the token exchange must send the same string. */
  redirectUri: string;
}

/** What the callback hands an adapter to exchange the code. */
export interface OAuthCodeInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

/** A linked account, as `connect` reports it. */
export interface ConnectResult {
  credentials: OAuthTokenGrant;
  /** Stable account id: Google `sub` / Microsoft `oid` / Apple email. */
  accountSubject: string;
  /** Display label (the account email), or null when not disclosed. */
  accountLabel: string | null;
}

/** Account capability: every provider implements it. */
export interface CalendarAccountProvider {
  readonly key: CalendarProviderKey;
  /** Client id + secret present (Apple: always true). */
  isConfigured(): Promise<boolean>;
  /** Consent URL carrying `state`, PKCE S256 and `redirect_uri`. */
  buildAuthUrl(input: AuthUrlInput): Promise<string>;
  /** Exchange an authorization code. Bad/expired code → `ProviderAuthError`. */
  connect(input: OAuthCodeInput): Promise<ConnectResult>;
  /** New access token; keeps `refreshToken` unless the provider rotates it. */
  refresh(credentials: OAuthCredentials): Promise<OAuthCredentials>;
  /** Revoke the grant (no-op for Apple). */
  disconnect(credentials: CalendarCredentials): Promise<void>;
}

/** Half-open instant range `[start, end)`. */
export interface TimeRange {
  start: Date;
  end: Date;
}

export interface ProviderCalendar {
  id: string;
  /** User-facing calendar name only (e.g. "Work"). */
  name: string;
  primary: boolean;
  writable: boolean;
  /** Matches the connection's `dedicated_calendar_id`. */
  isRaidLedger: boolean;
}

export interface BusyBlock {
  start: Date;
  end: Date;
  allDay: boolean;
  /** YYYY-MM-DD bounds, set iff `allDay`. */
  allDayDates?: { first: string; lastInclusive: string };
  /** Parsed Raid Ledger copy id, when present (`rl-copy-id.helpers`). */
  ourId?: string;
}

export interface FetchBusyResult {
  blocks: BusyBlock[];
  /** Per-calendar ctag / sync-token (Apple); opaque for others. */
  cursor?: Record<string, string>;
  /** Apple ctag hit: the caller keeps the previous blocks. */
  unchanged?: boolean;
}

/** Read capability (ROK-1593). Declared now; no adapter implements it yet. */
export interface CalendarReadCapability {
  listCalendars(credentials: CalendarCredentials): Promise<ProviderCalendar[]>;
  fetchBusy(
    credentials: CalendarCredentials,
    range: TimeRange,
    calendarIds: string[],
    cursor?: Record<string, string>,
  ): Promise<FetchBusyResult>;
}

export interface CopyEventInput {
  /** `rl:<instance>:<eventId>:<userId>` (`rl-copy-id.helpers`). */
  copyId: string;
  title: string;
  description: string;
  url: string;
  start: Date;
  end: Date;
  /** true → "(Tentative) " title + Free; false → Busy. */
  tentative: boolean;
}

export interface CopyRef {
  calendarId: string;
  providerEventId: string;
  etag?: string;
}

/** Write capability (ROK-1596). Declared now; no adapter implements it yet. */
export interface CalendarWriteCapability {
  ensureRaidLedgerCalendar(
    credentials: CalendarCredentials,
    knownId: string | null,
  ): Promise<string>;
  upsertEvent(
    credentials: CalendarCredentials,
    calendarId: string,
    input: CopyEventInput,
    existing: CopyRef | null,
  ): Promise<CopyRef>;
  /** A 404/410 counts as success. */
  deleteEvent(credentials: CalendarCredentials, ref: CopyRef): Promise<void>;
  deleteRaidLedgerCalendar(
    credentials: CalendarCredentials,
    calendarId: string,
  ): Promise<void>;
}

/** A provider with every capability (the fake, and adapters once complete). */
export type CalendarProvider = CalendarAccountProvider &
  CalendarReadCapability &
  CalendarWriteCapability;
