/**
 * ROK-657 magic-link token pickup, hardened in ROK-1366.
 *
 * The API ships the single-use sign-in token in the URL *fragment*
 * (`#token=`). A fragment never leaves the browser, so it stays out of server
 * and reverse-proxy access logs, out of the `Referer` header on outbound
 * subresource requests, and out of link-tracker redirect chains.
 *
 * The fragment is the ONLY carrier. A query-string `?token=` is somebody
 * else's param (the join page reads it as an intent token), so it is never
 * read here and never stripped.
 */

interface UrlParts {
  pathname: string;
  search: string;
  hash: string;
}

/** Read a magic-link token from a location's fragment. */
export function readMagicLinkToken(location: { hash: string }): string | null {
  return new URLSearchParams(location.hash.replace(/^#/, '')).get('token');
}

/**
 * Build the cleaned-up URL for a location whose fragment carried a token.
 * Path and query string are kept verbatim; only the fragment `token` goes.
 */
export function stripMagicLinkToken(location: UrlParts): string {
  return location.pathname + location.search + stripTokenFromHash(location.hash);
}

/**
 * Read the fragment token and drop it from the address bar in one step.
 * Runs at module load, before React renders, so the token never reaches
 * history, the router, or a render-time Referer. Returns null (and leaves
 * history alone) when the fragment carries no token.
 */
export function takeMagicLinkToken(win: {
  location: UrlParts;
  history: Pick<History, 'replaceState'>;
}): string | null {
  const token = readMagicLinkToken(win.location);
  if (token) {
    win.history.replaceState(null, '', stripMagicLinkToken(win.location));
  }
  return token;
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
