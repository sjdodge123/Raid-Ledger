/** ROK-1813 — pure helpers for the signed-out guild card (kept out of the component file for fast refresh). */
import type { PublicGuildCard } from '@raid-ledger/contract';

/** "~140 members", or "Fewer than 10 members" when the server rounded it away (D6). */
export function memberCountLabel(approx: number | null): string {
    return approx === null ? 'Fewer than 10 members' : `~${approx} members`;
}

/** The apply link to render, or null: closed / unset recruitment, no link, or anything but https. */
export function visibleApplyUrl(card: PublicGuildCard): string | null {
    const r = card.recruitment;
    if (r === null || r.state === 'closed' || r.applyUrl === null) return null;
    try {
        return new URL(r.applyUrl).protocol === 'https:' ? r.applyUrl : null;
    } catch {
        return null;
    }
}
