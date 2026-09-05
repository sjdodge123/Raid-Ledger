/**
 * Copy helpers for the tie readiness card (ROK-1374, D12).
 *
 * Every string here degrades rather than errors: a missing size reads as an
 * invitation to add one, a missing estimate simply is not rendered, and a size
 * ALWAYS carries its provenance and its age (AC12) so a stale figure is
 * discounted by the reader instead of trusted.
 */
import { formatDistanceToNow } from 'date-fns';
import type { InstallSizeSource } from '@raid-ledger/contract';

/** "46 GB" / "3.5 GB" — decimal GB, the unit store pages quote. */
export function formatSizeGb(bytes: number): string {
    const gb = bytes / 1_000_000_000;
    return gb >= 10 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

/** "3 months ago" — the age half of every size line. */
export function formatAge(iso: string | null): string | null {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return formatDistanceToNow(date, { addSuffix: true });
}

/**
 * The size line: `46 GB · entered 3 months ago` or
 * `46 GB · from Steam depots · updated 2 days ago`. Returns `null` when there
 * is no size — the caller renders the "Size unknown · Add it" affordance,
 * never an error state.
 */
export function formatSizeLine(
    bytes: number | null,
    source: InstallSizeSource | null,
    updatedAt: string | null,
): string | null {
    if (bytes === null) return null;
    const size = formatSizeGb(bytes);
    const age = formatAge(updatedAt);
    if (source === 'steam_depot') {
        return age
            ? `${size} · from Steam depots · updated ${age}`
            : `${size} · from Steam depots`;
    }
    return age ? `${size} · entered ${age}` : `${size} · entered by hand`;
}

/**
 * The estimate line: `~38 min at 150 Mbps`. Returns `null` when either input is
 * missing, and never renders `0 min` — a sub-minute download reads as
 * `~1 min`, because "0 min" reads as "instant" rather than "unknown".
 */
export function formatEstimateLine(
    minutes: number | null,
    speedMbps: number | null,
): string | null {
    if (minutes === null || speedMbps === null) return null;
    const rounded = Math.max(1, Math.round(minutes));
    return `~${rounded} min at ${Math.round(speedMbps)} Mbps`;
}

/** "7 of 9 on the roster own it". */
export function formatOwnershipLine(owned: number, rosterSize: number): string {
    return `${owned} of ${rosterSize} on the roster own it`;
}

/** "expires 12 Mar 2026" — the deadline half of the waiting line (D16 / E20). */
export function formatExpiry(iso: string | null): string | null {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

/** How each auto-measurement refusal reads to the person it happened to. */
const AUTO_SPEED_SKIP_COPY: Record<string, string> = {
    'save-data':
        'Not measured automatically while Data Saver is on — add your connection speed instead.',
    cellular:
        'Not measured automatically on a metered connection — add your connection speed instead.',
    'unknown-connection':
        'Not measured automatically: this browser does not report what kind of connection you are on — add your connection speed instead.',
};

/**
 * Explain a declined automatic measurement in one line (E17).
 *
 * A guard that refuses silently is indistinguishable from a broken feature, so
 * the reason is always said out loud next to the manual entry affordance. An
 * unrecognised reason still gets a line — vagueness beats silence.
 */
export function formatAutoSpeedSkip(reason: string | null): string | null {
    if (!reason || reason === 'ok') return null;
    return (
        AUTO_SPEED_SKIP_COPY[reason] ??
        'Not measured automatically — add your connection speed instead.'
    );
}
