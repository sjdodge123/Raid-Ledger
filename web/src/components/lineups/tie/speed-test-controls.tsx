/**
 * The pieces of a speed measurement, shared by the tie card's consent modal and
 * the onboarding wizard's Connection step (ROK-1374, operator ruling
 * 2026-09-05).
 *
 * Both surfaces ask for exactly the same thing — consent stated in words, then
 * a measurement or a typed figure — so the copy lives in one place rather than
 * being said twice and drifting apart. The run itself is `useRunSpeedTest`, in
 * its own module because a file that exports components may not also export a
 * hook (react-refresh).
 */
import { useState, type JSX } from 'react';
import { SetConnectionSpeedSchema } from '@raid-ledger/contract';
import { useSetConnectionSpeed } from '../../../hooks/use-connection-speed';
import { toast } from '../../../lib/toast';

/**
 * What the user is agreeing to, in words rather than in a link. Shaped after
 * the disclosure the familiar consumer speed test shows (operator, 2026-09-05):
 * cost first, then who sees what.
 */
export function ConsentCopy(): JSX.Element {
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

/**
 * Type a figure instead of measuring one.
 *
 * @param onSaved - called once the figure is persisted; the modal closes on it,
 * the wizard step simply stays where it is.
 */
export function ManualEntry({ onSaved }: { onSaved: () => void }): JSX.Element {
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
        save.mutate(parsed.data, { onSuccess: onSaved });
    };
    return (
        <div className="flex items-center gap-2">
            <label className="text-sm text-muted" htmlFor="speed-test-mbps">
                Download speed (Mbps)
            </label>
            <input
                id="speed-test-mbps"
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
