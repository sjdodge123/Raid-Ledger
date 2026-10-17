/**
 * ROK-1564: the poll page's "Edit my week" answer sends people here with
 * `?return=<poll path>`. Only a same-origin RELATIVE path is honoured — a full
 * URL or a protocol-relative `//host` would be an open redirect.
 */
export function safeReturnPath(raw: string | null): string | null {
    if (!raw) return null;
    if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
    // whitespace or control characters never belong in a path we redirect to
    if (/\s/.test(raw) || [...raw].some((ch) => ch.charCodeAt(0) < 0x20)) return null;
    return raw;
}
