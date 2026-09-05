/**
 * The wizard's Connection step (ROK-1374, operator ruling 2026-09-05).
 *
 * Optional, like every step around it: the wizard's own Skip/Next apply and
 * nothing here registers a validator. It asks in exactly the words the tie
 * card's consent modal uses — the copy and the run are shared modules — because
 * a second wording of the same data cost is a second thing to keep true.
 *
 * A returning user is shown the figure they already have with the way to
 * update it, not the pitch again. Nothing measures on its own: the stored
 * figure persists until someone presses a button.
 */
import { useState, type JSX } from 'react';
import { useConnectionSpeed } from '../../hooks/use-connection-speed';
import { useRunSpeedTest } from '../../hooks/use-run-speed-test';
import {
    ConsentCopy,
    ManualEntry,
} from '../lineups/tie/speed-test-controls';
import { ShareEtaRow } from '../lineups/tie/share-eta-row';
import { SpeedGauge } from '../lineups/tie/SpeedGauge';
import { formatMbps } from '../lineups/tie/speed-gauge.helpers';

/** The ask, and the one reason it is being made. */
function StepHeader(): JSX.Element {
    return (
        <div className="text-center mb-2">
            <h2 className="text-lg font-bold text-foreground">
                How fast is your connection?
            </h2>
            <p className="text-muted text-sm mt-1">
                When a lineup ties, the card can tell the group how long each game
                would take you to download.
            </p>
        </div>
    );
}

/** What is already on record, and the way to replace it. */
function StoredFigure({
    mbps,
    onUpdate,
}: {
    mbps: number;
    onUpdate: () => void;
}): JSX.Element {
    return (
        <p className="text-sm text-foreground text-center">
            {`Your download speed: ${formatMbps(mbps)} Mbps`}
            {' · '}
            <button
                type="button"
                onClick={onUpdate}
                aria-label="Update your connection speed"
                className="underline hover:text-foreground"
            >
                Update
            </button>
        </p>
    );
}

/** Consent, then measure or type — the same three affordances as the modal. */
function MeasureControls({ onDone }: { onDone: () => void }): JSX.Element {
    const [manual, setManual] = useState(false);
    const { running, sample, run } = useRunSpeedTest(onDone);
    return (
        <div className="mt-3 space-y-3">
            <ConsentCopy />
            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => void run()}
                    disabled={running}
                    className="rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                    {running ? 'Running…' : 'Run test'}
                </button>
                <button
                    type="button"
                    onClick={() => setManual(true)}
                    className="rounded border border-edge px-3 py-1 text-sm text-foreground"
                >
                    Enter manually
                </button>
            </div>
            {running && <SpeedGauge mbps={sample} caption="Testing download…" />}
            {manual && <ManualEntry onSaved={onDone} />}
        </div>
    );
}

/** Step: measure (or type) a download speed, and choose whether to share it. */
export function ConnectionStep(): JSX.Element {
    const { data: speed } = useConnectionSpeed();
    const [updating, setUpdating] = useState(false);
    const stored = speed?.downstreamMbps ?? null;
    return (
        <div className="max-w-xl mx-auto">
            <StepHeader />
            {stored !== null && (
                <StoredFigure mbps={stored} onUpdate={() => setUpdating(true)} />
            )}
            {(stored === null || updating) && (
                <MeasureControls onDone={() => setUpdating(false)} />
            )}
            <div className="mt-3">
                <ShareEtaRow speed={speed} />
            </div>
        </div>
    );
}
