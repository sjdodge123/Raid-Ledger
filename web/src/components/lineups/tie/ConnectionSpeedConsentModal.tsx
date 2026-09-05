/**
 * Speed-test consent (ROK-1374, D10 / AC21).
 *
 * The copy states the data cost in plain words before anything is downloaded,
 * because a metered line is exactly the connection that benefits most from a
 * download estimate and can least afford to pay for one. Consent is revocable
 * here, and revoking deletes the figure as well as the permission.
 *
 * The figure quoted is the FULL transfer, not the app's 5 s cap: ndt7 exposes
 * no abort path (the Worker handle never leaves the library), so the cap bounds
 * how long we wait for a number, not how much data moves. Quoting 5 s worth
 * would be asking for consent to something smaller than what happens.
 */
import { useState, type JSX } from 'react';
import type { ConnectionSpeedDto } from '@raid-ledger/contract';
import { Modal } from '../../ui/modal';
import { useSpeedTestConsent } from '../../../hooks/use-connection-speed';
import { SpeedGauge } from './SpeedGauge';
import { ShareEtaRow } from './share-eta-row';
import { ConsentCopy, ManualEntry } from './speed-test-controls';
import { useRunSpeedTest } from '../../../hooks/use-run-speed-test';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    speed: ConnectionSpeedDto | undefined;
}

/** Consent, measure, or revoke. */
export function ConnectionSpeedConsentModal(props: Props): JSX.Element {
    const { isOpen, onClose, speed } = props;
    const [manual, setManual] = useState(false);
    const consent = useSpeedTestConsent();
    const { running, sample, run } = useRunSpeedTest(onClose);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Measure your connection">
            <div className="space-y-3">
                <ConsentCopy />
                <ShareEtaRow speed={speed} />
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
                    {speed?.consentAt && (
                        <button
                            type="button"
                            onClick={() => consent.mutate({ consent: false })}
                            className="rounded border border-edge px-3 py-1 text-sm text-foreground"
                        >
                            Revoke
                        </button>
                    )}
                </div>
                {running && <SpeedGauge mbps={sample} caption="Testing download…" />}
                {manual && <ManualEntry onSaved={onClose} />}
            </div>
        </Modal>
    );
}
