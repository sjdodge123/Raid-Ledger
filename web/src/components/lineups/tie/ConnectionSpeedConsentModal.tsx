/**
 * Speed-test consent (ROK-1374, D10 / AC21).
 *
 * The copy states the data cost in plain words before anything is downloaded,
 * because a metered line is exactly the connection that benefits most from a
 * download estimate and can least afford to pay for one. Consent is revocable
 * here, and revoking deletes the figure as well as the permission.
 */
import { useState, type JSX } from 'react';
import { SetConnectionSpeedSchema, type ConnectionSpeedDto } from '@raid-ledger/contract';
import { Modal } from '../../ui/modal';
import {
    useSetConnectionSpeed,
    useSpeedTestConsent,
} from '../../../hooks/use-connection-speed';
import { runSpeedTest } from '../../../lib/speedtest/ndt7-runner';
import { toast } from '../../../lib/toast';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    speed: ConnectionSpeedDto | undefined;
}

/** What the user is agreeing to, in words rather than in a link. */
function ConsentCopy(): JSX.Element {
    return (
        <div className="space-y-2 text-sm text-gray-300">
            <p>
                The test measures your download speed using M-Lab&apos;s open ndt7
                service. It downloads roughly 100–200 MB, more on a fast line, so skip
                it on a metered or capped connection.
            </p>
            <p>
                M-Lab publishes the data from every test it runs, including the client
                IP address it saw. We keep only your download speed in Mbps — no server
                names, no diagnostics — and only you can see it.
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
            <label className="text-sm text-gray-300" htmlFor="tie-speed-mbps">
                Download speed (Mbps)
            </label>
            <input
                id="tie-speed-mbps"
                type="number"
                min="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-24 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-gray-100"
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
    const consent = useSpeedTestConsent();
    const save = useSetConnectionSpeed();

    const run = async (): Promise<void> => {
        setRunning(true);
        try {
            await consent.mutateAsync({ consent: true });
            const downstreamMbps = await runSpeedTest();
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
                        className="rounded border border-gray-600 px-3 py-1 text-sm text-gray-200"
                    >
                        Enter manually
                    </button>
                    {speed?.consentAt && (
                        <button
                            type="button"
                            onClick={() => consent.mutate({ consent: false })}
                            className="rounded border border-gray-600 px-3 py-1 text-sm text-gray-200"
                        >
                            Revoke
                        </button>
                    )}
                </div>
                {manual && <ManualEntry onClose={onClose} />}
            </div>
        </Modal>
    );
}
