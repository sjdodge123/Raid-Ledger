/**
 * ROK-1598 (spec §2.3 `withDiscovery`, D8): resolve the CalDAV login and
 * calendar home set for one adapter call.
 *
 * The home set is discovered once at connect and stored on the credentials.
 * A call made without one discovers first; a call whose work answers 404/410
 * rediscovers once — when iCloud moved the account to another partition the
 * home set changes, the new credentials go to the persister and the work runs
 * again. An unchanged home set means the 404 was real: it is rethrown as-is.
 * (301s from a partition move are already followed by the client, D2.)
 */
import { NotFoundError, ProviderAuthError } from '../calendar-provider.errors';
import type {
  CalDavCredentials,
  CalendarCredentials,
} from '../calendar-provider.interface';
import type { CalDavAuth } from './apple-caldav-http';
import { discover } from './apple-caldav-client.helpers';

/**
 * Stores credentials whose `principalUrl` / `homeSetUrl` were rediscovered.
 * The adapter's methods do not know the connection row, so the caller (L4)
 * supplies one; the default keeps the result for this call only.
 */
export type CalDavCredentialPersister = (
  next: CalDavCredentials,
) => Promise<void>;

export const noopCalDavPersister: CalDavCredentialPersister = () =>
  Promise.resolve();

/** A login plus the (slash-terminated) home set it reaches. */
export interface CalDavHome {
  auth: CalDavAuth;
  homeSetUrl: string;
}

/** `ProviderAuthError('credentials_kind')` for non-CalDAV credentials. */
export function caldavCredentials(
  creds: CalendarCredentials,
): CalDavCredentials {
  if (creds.kind !== 'caldav') {
    throw new ProviderAuthError('credentials_kind');
  }
  return creds;
}

export function caldavAuth(creds: CalDavCredentials): CalDavAuth {
  return { username: creds.username, appPassword: creds.appPassword };
}

const withSlash = (url: string) => (url.endsWith('/') ? url : `${url}/`);
const sameUrl = (a: string, b: string) =>
  withSlash(new URL(a).href) === withSlash(new URL(b).href);

async function rediscover(
  creds: CalDavCredentials,
  persist: CalDavCredentialPersister,
): Promise<CalDavHome> {
  const auth = caldavAuth(creds);
  const found = await discover(auth);
  await persist({ ...creds, ...found });
  return { auth, homeSetUrl: withSlash(found.homeSetUrl) };
}

/** Run `fn` against the home set, discovering / rediscovering per §2.3. */
export async function withDiscovery<T>(
  credentials: CalendarCredentials,
  persist: CalDavCredentialPersister,
  fn: (home: CalDavHome) => Promise<T>,
): Promise<T> {
  const creds = caldavCredentials(credentials);
  const stored = creds.homeSetUrl;
  if (!stored) return fn(await rediscover(creds, persist));
  try {
    return await fn({ auth: caldavAuth(creds), homeSetUrl: withSlash(stored) });
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
    const auth = caldavAuth(creds);
    const found = await discover(auth);
    if (sameUrl(found.homeSetUrl, stored)) throw err;
    await persist({ ...creds, ...found });
    return fn({ auth, homeSetUrl: withSlash(found.homeSetUrl) });
  }
}

/** CalDAV-safe calendar / resource segment (D8). */
const SEGMENT = /^[A-Za-z0-9._~%-]{1,200}$/;
/** `%2e` is a dot to WHATWG URL resolution: `%2e%2e/` escapes the home set. */
const ENCODED_DOT = /%2e/i;

export const isSafeSegment = (s: string): boolean =>
  SEGMENT.test(s) && !ENCODED_DOT.test(s) && s !== '.' && s !== '..';

/** `<home>/<calendarId>/`; null when the id is not a safe segment. */
export function collectionUrl(
  homeSetUrl: string,
  calendarId: string,
): string | null {
  if (!isSafeSegment(calendarId)) return null;
  return new URL(`${calendarId}/`, withSlash(homeSetUrl)).href;
}
