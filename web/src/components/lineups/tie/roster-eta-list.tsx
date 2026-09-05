/**
 * Everyone's wait for one tied game (ROK-1374, operator ruling 2026-09-05).
 *
 * A tie is decided by the group, so the card names the whole roster rather
 * than only the person reading it: "who have we not heard from" is part of the
 * decision. Sharing is a separate opt-in, so `not shared` is the honest
 * default and is stated rather than hidden.
 *
 * Only MINUTES ever render for another member — never their speed, its source
 * or when it was measured (AC20). The viewer's own line uses their own figure
 * whether or not they share it.
 */
import type { JSX } from 'react';
import type { RosterEtaDto } from '@raid-ledger/contract';

/** Unknowns sort last: a decidable wait is what the group is comparing. */
const STATUS_RANK: Record<RosterEtaDto['status'], number> = {
    eta: 0,
    no_speed: 1,
    not_shared: 2,
};

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

/** True when a line can quote a wait rather than a reason it cannot. */
function hasEta(eta: RosterEtaDto): boolean {
    return eta.status === 'eta' && eta.estimatedDownloadMinutes !== null;
}

/** One member's line: `Mira ~41 min`, `Admin · no speed yet`, `Carl · not shared`. */
export function formatRosterEtaLine(eta: RosterEtaDto): string {
    if (hasEta(eta)) {
        return `${eta.displayName} ${formatEtaMinutes(eta.estimatedDownloadMinutes as number)}`;
    }
    const reason = eta.status === 'no_speed' ? 'no speed yet' : 'not shared';
    return `${eta.displayName} · ${reason}`;
}

interface Props {
    etas: RosterEtaDto[];
    viewerSpeedMbps: number | null;
    onAddSpeed: () => void;
}

/** The viewer's own wait, plus the way back into the measurement modal. */
function ViewerLine({
    minutes,
    onAddSpeed,
}: {
    minutes: number;
    onAddSpeed: () => void;
}): JSX.Element {
    return (
        <li data-testid="roster-eta" className="text-sm text-foreground">
            {`You ${formatEtaMinutes(minutes)}`}
            {' · '}
            <button
                type="button"
                onClick={onAddSpeed}
                aria-label="Update your connection speed"
                className="underline hover:text-foreground"
            >
                Update
            </button>
        </li>
    );
}

/** The invitation shown in the viewer's slot while they have no figure. */
function AddSpeedLine({ onAddSpeed }: { onAddSpeed: () => void }): JSX.Element {
    return (
        <p className="text-sm text-muted">
            <button
                type="button"
                onClick={onAddSpeed}
                className="underline hover:text-foreground"
            >
                Add your connection speed
            </button>
        </p>
    );
}

/** Every roster member's wait for one tied game, or nothing to say at all. */
export function RosterEtaList(props: Props): JSX.Element | null {
    const { etas, viewerSpeedMbps, onAddSpeed } = props;
    const sorted = sortRosterEtas(etas);
    const viewer = sorted.find((e) => e.isViewer && hasEta(e));
    // A viewer with no wait to quote gets the invitation in that slot instead
    // of a "no speed yet" line about themselves.
    const others = sorted.filter((e) => e === viewer || !e.isViewer);
    const showAdd = !viewer && viewerSpeedMbps === null;
    if (others.length === 0 && !showAdd) return null;
    return (
        <div>
            <ul>
                {others.map((eta) =>
                    eta === viewer ? (
                        <ViewerLine
                            key={eta.userId}
                            minutes={eta.estimatedDownloadMinutes as number}
                            onAddSpeed={onAddSpeed}
                        />
                    ) : (
                        <li
                            key={eta.userId}
                            data-testid="roster-eta"
                            className="text-sm text-muted"
                        >
                            {formatRosterEtaLine(eta)}
                        </li>
                    ),
                )}
            </ul>
            {showAdd && <AddSpeedLine onAddSpeed={onAddSpeed} />}
        </div>
    );
}
