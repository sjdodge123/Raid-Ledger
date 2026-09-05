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
import { SetConnectionSpeedSchema, type ConnectionSpeedDto } from '@raid-ledger/contract';
import { Modal } from '../../ui/modal';
import {
    useSetConnectionSpeed,
    useSpeedTestConsent,
} from '../../../hooks/use-connection-speed';
import { runSpeedTest } from '../../../lib/speedtest/ndt7-runner';
import { SpeedGauge } from './SpeedGauge';
import { ShareEtaRow } from './share-eta-row';
import { toast } from '../../../lib/toast';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    speed: ConnectionSpeedDto | undefined;
}

/**
 * What the user is agreeing to, in words rather than in a link. Shaped after
 * the disclosure the familiar consumer speed test shows (operator, 2026-09-05):
 * cost first, then who sees what.
 */
function ConsentCopy(): JSX.Element {
    return (
        <div className="space-y-2 text-sm text-muted">
            <p>
                Check your download speed in about 10 seconds. The test usually
                transfers less than 100 MB of data, but may transfer more on fast
                connections and cannot be stopped early — skip it on a metered or
                capped connection.
            </p>
            <p>
                To run the test, you&apos;ll be connected to Measurement Lab (M-Lab)
                and your IP address will be shared with them and processed in
                accordance with their{' '}
                <a
                    href="https://www.measurementlab.net/privacy/"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                >
                    privacy policy
                </a>
                . M-Lab conducts the test and publicly publishes all test results to
                promote internet research. Published information includes your IP
                address and test results, but doesn&apos;t include any other
                information about you.
            </p>
            <p>
                We keep only your download speed in Mbps — no server names, no
                diagnostics — and only you can see it.
            </p>
        </div>
    );
}

/** Type a figure instead of measuring one. */
function ManualEntry({ onClose }: { onClose: () => void }): JSX.Element {
    const [value, setValue] = useState('');
    const save = useSetConnectionSpeed();
    const submit = (): void => {
        const parsed = SetConnectionSpeedSchema.safeParse({
            downstreamMbps: Number.parseFloat(value),
            source: 'manual',
        });
        if (!parsed.success) {
            toast.error('Enter your download speed in Mbps');
            return;
        }
        save.mutate(parsed.data, { onSuccess: onClose });
    };
    return (
        <div className="flex items-center gap-2">
            <label className="text-sm text-muted" htmlFor="tie-speed-mbps">
                Download speed (Mbps)
            </label>
            <input
                id="tie-speed-mbps"
                type="number"
                min="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-24 rounded border border-edge bg-surface px-2 py-1 text-foreground"
            />
            <button type="button" onClick={submit} className="text-sm underline">
                Save
            </button>
        </div>
    );
}

/** Consent, measure, or revoke. */
export function ConnectionSpeedConsentModal(props: Props): JSX.Element {
    const { isOpen, onClose, speed } = props;
    const [manual, setManual] = useState(false);
    const [running, setRunning] = useState(false);
    const [sample, setSample] = useState<number | null>(null);
    const consent = useSpeedTestConsent();
    const save = useSetConnectionSpeed();

    const run = async (): Promise<void> => {
        setRunning(true);
        setSample(null);
        try {
            await consent.mutateAsync({ consent: true });
            const downstreamMbps = await runSpeedTest(undefined, setSample);
            await save.mutateAsync({ downstreamMbps, source: 'ndt7' });
            onClose();
        } catch {
            toast.error('Speed test failed — enter your speed instead');
        } finally {
            setRunning(false);
        }
    };

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
                {manual && <ManualEntry onClose={onClose} />}
            </div>
        </Modal>
    );
}
