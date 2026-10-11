/**
 * ROK-1757: scheme ALLOW-list for any untrusted URL rendered as an `href`.
 * Deliberately not a `javascript:` deny-list — `data:`, `vbscript:`, `blob:`
 * and lookalikes would each need their own entry, and one miss is a hole.
 *
 * @param raw candidate url from API data or user content
 * @returns the url unchanged when it parses as an absolute `http:`/`https:`
 *   url; otherwise undefined, so the caller renders no link
 */
export function safeHttpUrl(raw: string | null | undefined): string | undefined {
    if (!raw) return undefined;
    try {
        const { protocol } = new URL(raw);
        return protocol === 'http:' || protocol === 'https:' ? raw : undefined;
    } catch {
        return undefined;
    }
}
