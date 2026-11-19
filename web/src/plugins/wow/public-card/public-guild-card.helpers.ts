/** ROK-1813 — pure helpers for the signed-out guild card (kept out of the component file for fast refresh). */
import type { PublicGuildCard } from '@raid-ledger/contract';
import { safeHttpUrl } from '../../../lib/safe-http-url';

/** "~140 members", or "Fewer than 10 members" when the server rounded it away (D6). */
export function memberCountLabel(approx: number | null): string {
    return approx === null ? 'Fewer than 10 members' : `~${approx} members`;
}

/**
 * The apply link to render, or null: closed / unset recruitment, no link, or
 * anything but https. The scheme allow-list is `safeHttpUrl` (design system);
 * this card narrows it to https only (D7).
 */
export function visibleApplyUrl(card: PublicGuildCard): string | null {
    const r = card.recruitment;
    if (r === null || r.state === 'closed') return null;
    const url = safeHttpUrl(r.applyUrl);
    // safeHttpUrl already parsed it, so this second parse cannot throw.
    return url !== undefined && new URL(url).protocol === 'https:' ? url : null;
}
