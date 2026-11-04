/**
 * ROK-1597: Microsoft identity platform v2.0 + Graph v1.0 constants (spec
 * §3.1). The `common` tenant accepts personal and work/school accounts.
 * Read-mask and copy-property constants are added by the read (7a-2) and
 * write (7b-1) layers that own them.
 */

const MS_LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0';

export const MS_AUTHORIZE_URL = `${MS_LOGIN}/authorize`;
export const MS_TOKEN_URL = `${MS_LOGIN}/token`;
export const GRAPH_API = 'https://graph.microsoft.com/v1.0';
/** Prefix a token-endpoint `scope` echo may carry on Graph scopes. */
export const GRAPH_SCOPE_PREFIX = 'https://graph.microsoft.com/';

/** The one scope that covers calendar read AND write (ROK-669 §4.2). */
export const MS_CALENDAR_SCOPE = 'Calendars.ReadWrite';
/** The RULED connect scope set — nothing else (no `openid`). */
export const MS_SCOPES: readonly string[] = [
  'offline_access',
  'User.Read',
  MS_CALENDAR_SCOPE,
];
/** Scopes a grant must hold to be stored (`offline_access` is judged by
 * the presence of a refresh token, since its echo is unreliable). */
export const MS_REQUIRED_SCOPES: readonly string[] = [MS_CALENDAR_SCOPE];

/**
 * Documented Outlook throttling limits (calendar included), per app id +
 * mailbox: 10,000 requests per 10 minutes and 4 concurrent requests
 * (https://learn.microsoft.com/en-us/graph/throttling-limits). Reference
 * only — no behaviour keys on it. Calls here are sequential per connection
 * (never more than one in flight per mailbox); a 429 maps to
 * `RateLimitError(Retry-After)` and the queue backs off.
 */
export const OUTLOOK_THROTTLE_LIMITS = {
  requestsPer10Min: 10_000,
  concurrentPerMailbox: 4,
} as const;

/** Graph returns every dateTime in UTC with this `Prefer` value. */
export const PREFER_UTC = 'outlook.timezone="UTC"';
/** Stable event ids across folder moves. */
export const PREFER_IMMUTABLE_ID = 'IdType="ImmutableId"';

/** `/me` projection: the stable id plus the two possible labels. */
export const MS_ME_URL = `${GRAPH_API}/me?$select=id,mail,userPrincipalName`;

/**
 * Raid Ledger's single-value extended property on every copy (spec §3.4).
 * NEVER change this string: every copy already written carries it, and a new
 * GUID orphans them all (adoption and the read-side `ourId` both key on it).
 * Minted once in lane 7a-2 because the read `$expand` needs it; 7b-1 writes
 * it on copies.
 */
export const RL_COPY_PROP_ID =
  'String {5ee82885-bb24-48df-8d4a-123f14548871} Name rlCopyId';

/**
 * §6.4.1 privacy — the exact `calendarView` `$select`. `isCancelled` and
 * `responseStatus` (the user's own reply only) back Q2; `originalStartTimeZone`
 * backs the §3.3 all-day correction. No subject, body, location or attendees.
 */
export const MICROSOFT_EVENTS_SELECT =
  'start,end,showAs,isAllDay,isCancelled,responseStatus,originalStartTimeZone';
/** Extended properties come back only via `$expand`, never `$select`. */
export const MICROSOFT_EVENTS_EXPAND = `singleValueExtendedProperties($filter=id eq '${RL_COPY_PROP_ID}')`;
/** §6.4.1 — the exact calendar-list `$select` (names shown, never stored). */
export const MICROSOFT_CALENDARS_SELECT = 'id,name,canEdit,isDefaultCalendar';
/** Conservative page sizes; paging follows `@odata.nextLink` (UNVERIFIED max). */
export const MICROSOFT_EVENTS_PAGE_SIZE = 250;
export const MICROSOFT_CALENDARS_PAGE_SIZE = 100;
/** Stop following `@odata.nextLink` after this many pages (as Google). */
export const MICROSOFT_READ_MAX_PAGES = 10;
/** Every read asks for UTC times and immutable ids (one `Prefer` header). */
export const MICROSOFT_READ_PREFER: readonly string[] = [
  PREFER_UTC,
  PREFER_IMMUTABLE_ID,
];
