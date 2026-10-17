/**
 * One human-initiated speed measurement (ROK-1374).
 *
 * Shared by the tie card's consent modal and the onboarding wizard's Connection
 * step. Nothing here ever fires on its own: the app stopped measuring
 * automatically on the operator's 2026-09-05 ruling, so every run behind this
 * hook is a button someone pressed.
 */
import { useState } from 'react';
import { runSpeedTest } from '../lib/speedtest/ndt7-runner';
import {
    useSetConnectionSpeed,
    useSpeedTestConsent,
} from './use-connection-speed';
import { toast } from '../lib/toast';

/** A measurement in flight: whether it is running, and its latest sample. */
export interface SpeedTestRun {
    running: boolean;
    /** Latest live figure in Mbps, or null before the first one arrives. */
    sample: number | null;
    run: () => Promise<void>;
}

/**
 * Consent, measure, persist — in that order, and nothing is written when any
 * step fails (E18). A failure leaves a toast and the manual affordance.
 *
 * @param onDone - called after a figure is successfully persisted.
 */
export function useRunSpeedTest(onDone?: () => void): SpeedTestRun {
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
            onDone?.();
        } catch {
            toast.error('Speed test failed — enter your speed instead');
        } finally {
            setRunning(false);
        }
    };

    return { running, sample, run };
}
