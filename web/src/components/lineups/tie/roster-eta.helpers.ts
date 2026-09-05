/**
 * Copy + ordering for the roster ETA list (ROK-1374, operator ruling
 * 2026-09-05).
 *
 * Separate from the component so the strings and the sort can be reasoned
 * about (and fast-refresh works) on their own. Only MINUTES are ever formatted
 * for another member — their speed, its source and its age stay self-scoped
 * (AC20).
 */
import type { RosterEtaDto } from '@raid-ledger/contract';

/** Unknowns sort last: a decidable wait is what the group is comparing. */
const STATUS_RANK: Record<RosterEtaDto['status'], number> = {
    eta: 0,
    no_speed: 1,
    not_shared: 2,
};

/** True when a line can quote a wait rather than a reason it cannot. */
export function hasEta(eta: RosterEtaDto): boolean {
    return eta.status === 'eta' && eta.estimatedDownloadMinutes !== null;
}

/** Viewer first, then the shortest wait, then the unknowns. Never mutates. */
export function sortRosterEtas(etas: readonly RosterEtaDto[]): RosterEtaDto[] {
    return [...etas].sort((a, b) => {
        if (a.isViewer !== b.isViewer) return a.isViewer ? -1 : 1;
        const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
        if (rank !== 0) return rank;
        const wait =
            (a.estimatedDownloadMinutes ?? 0) - (b.estimatedDownloadMinutes ?? 0);
        return wait !== 0 ? wait : a.displayName.localeCompare(b.displayName);
    });
}

/** "~23 min" — never "~0 min", which reads as "instant" rather than "unknown". */
export function formatEtaMinutes(minutes: number): string {
    return `~${Math.max(1, Math.round(minutes))} min`;
}

/** `Mira ~41 min`, `Admin · no speed yet`, `Carl · not shared`. */
export function formatRosterEtaLine(eta: RosterEtaDto): string {
    if (hasEta(eta)) {
        return `${eta.displayName} ${formatEtaMinutes(eta.estimatedDownloadMinutes as number)}`;
    }
    const reason = eta.status === 'no_speed' ? 'no speed yet' : 'not shared';
    return `${eta.displayName} · ${reason}`;
}
