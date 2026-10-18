/**
 * ROK-1845 — encode a value decoded from the URL (a route param, a `?notif=`
 * query value, a server-echoed code) before it goes into an API or in-app
 * path. `encodeURIComponent` keeps `/`, `?` and `#` inside the segment, but it
 * leaves `.` alone — and the URL parser treats `.`/`..` (and `%2e%2e`) as dot
 * segments — so those, and the empty segment, are refused outright.
 */
const UNSAFE_SEGMENTS: ReadonlySet<string> = new Set(['', '.', '..']);

/** The encoded segment, or null when the value cannot be a path segment. */
export function tryEncodePathSegment(value: string): string | null {
    if (UNSAFE_SEGMENTS.has(value)) return null;
    return encodeURIComponent(value);
}

/** The encoded segment; throws when the value cannot be a path segment. */
export function encodePathSegment(value: string): string {
    const segment = tryEncodePathSegment(value);
    if (segment === null) throw new Error('Invalid path segment');
    return segment;
}
