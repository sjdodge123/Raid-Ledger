/**
 * ROK-1845 — encode a value decoded from the URL (a route param, a `?notif=`
 * query value, a server-echoed code) before it goes into an API or in-app
 * path. `encodeURIComponent` keeps `?` and `#` inside the segment, but it
 * leaves `.` alone — and the URL parser treats `.`/`..` (and `%2e%2e`) as dot
 * segments — so those, and the empty segment, are refused outright.
 *
 * A value holding `/` or `\` is refused too. Encoding keeps it in one segment
 * only as far as the browser: production nginx (`proxy_pass http://…:3000/`,
 * a URI form) forwards its normalized URI, decoding `%2F` and collapsing `..`,
 * so `..%2F..%2Fadmin` would still reach `/admin` on the API.
 */
const UNSAFE_SEGMENTS: ReadonlySet<string> = new Set(['', '.', '..']);
const PATH_SEPARATOR = /[\\/]/;

/** The encoded segment, or null when the value cannot be a path segment. */
export function tryEncodePathSegment(value: string): string | null {
    if (UNSAFE_SEGMENTS.has(value) || PATH_SEPARATOR.test(value)) return null;
    return encodeURIComponent(value);
}

/** The encoded segment; throws when the value cannot be a path segment. */
export function encodePathSegment(value: string): string {
    const segment = tryEncodePathSegment(value);
    if (segment === null) throw new Error('Invalid path segment');
    return segment;
}
