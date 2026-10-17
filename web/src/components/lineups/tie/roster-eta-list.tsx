/**
 * Everyone's wait for one tied game (ROK-1374, operator ruling 2026-09-05).
 *
 * A tie is decided by the group, so the card names the whole roster rather
 * than only the person reading it: "who have we not heard from" is part of the
 * decision. Sharing is a separate opt-in, so `not shared` is the honest
 * default and is stated rather than hidden.
 *
 * The viewer's own line uses their own figure whether or not they share it,
 * and carries the way back into the measurement modal.
 */
import type { JSX } from 'react';
import type { RosterEtaDto } from '@raid-ledger/contract';
import {
    formatEtaMinutes,
    formatRosterEtaLine,
    hasEta,
    sortRosterEtas,
} from './roster-eta.helpers';

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

/** One other member: a wait, or the reason there isn't one. */
function MemberLine({ eta }: { eta: RosterEtaDto }): JSX.Element {
    return (
        <li data-testid="roster-eta" className="text-sm text-muted">
            {formatRosterEtaLine(eta)}
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
    const lines = sorted.filter((e) => e === viewer || !e.isViewer);
    const showAdd = !viewer && viewerSpeedMbps === null;
    if (lines.length === 0 && !showAdd) return null;
    return (
        <div>
            <ul>
                {lines.map((eta) =>
                    eta === viewer ? (
                        <ViewerLine
                            key={eta.userId}
                            minutes={eta.estimatedDownloadMinutes as number}
                            onAddSpeed={onAddSpeed}
                        />
                    ) : (
                        <MemberLine key={eta.userId} eta={eta} />
                    ),
                )}
            </ul>
            {showAdd && <AddSpeedLine onAddSpeed={onAddSpeed} />}
        </div>
    );
}
