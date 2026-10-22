/** Link-address normalisation for the editor's link row (ROK-1868 spec §3.6). */
import { isSafeMarkdownHref } from '@raid-ledger/contract';

/**
 * Normalise a typed address: trim, and prefix `https://` to a bare host.
 * @param raw - what the user typed
 * @returns the href to store, or null when it is not a safe link
 */
export function normalizeLinkInput(raw: string): string | null {
    const url = raw.trim();
    if (!url) return null;
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/') ? url : `https://${url}`;
    return isSafeMarkdownHref(withScheme) ? withScheme : null;
}
