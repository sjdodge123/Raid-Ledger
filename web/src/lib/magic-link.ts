/**
 * ROK-657 magic-link token pickup, hardened in ROK-1366.
 *
 * The API now ships the 15-minute token in the URL *fragment* (`#token=`)
 * rather than the query string. A fragment never leaves the browser, so it
 * stays out of server and reverse-proxy access logs, out of the `Referer`
 * header on outbound subresource requests, and out of link-tracker redirect
 * chains. The legacy `?token=` form is still accepted so links already sitting
 * in Discord channels keep working until they expire.
 */

/** Read a magic-link token from a location, fragment first. */
export function readMagicLinkToken(location: {
  search: string;
  hash: string;
}): string | null {
  const fromHash = new URLSearchParams(
    location.hash.replace(/^#/, ''),
  ).get('token');
  if (fromHash) return fromHash;
  return new URLSearchParams(location.search).get('token');
}

/** True when either carrier holds a token worth stripping from the URL. */
export function hasMagicLinkToken(location: {
  search: string;
  hash: string;
}): boolean {
  return readMagicLinkToken(location) !== null;
}

/**
 * Build the cleaned-up URL for a location that carried a token — the token is
 * removed from both carriers, every other param and fragment value is kept.
 */
export function stripMagicLinkToken(location: {
  pathname: string;
  search: string;
  hash: string;
}): string {
  const params = new URLSearchParams(location.search);
  params.delete('token');
  const query = params.toString();
  return (
    location.pathname + (query ? `?${query}` : '') + stripTokenFromHash(location.hash)
  );
}

/**
 * Only rewrite the fragment when it actually carries a token — a plain anchor
 * (`#roster`) is not a param list and round-tripping it through
 * URLSearchParams would corrupt it to `roster=`.
 */
function stripTokenFromHash(rawHash: string): string {
  const body = rawHash.replace(/^#/, '');
  if (!body) return '';
  const params = new URLSearchParams(body);
  if (!params.has('token')) return `#${body}`;
  params.delete('token');
  const rest = params.toString();
  return rest ? `#${rest}` : '';
}
