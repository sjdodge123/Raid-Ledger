/**
 * The automatic speed measurement policy (ROK-1374, D10 / E23 / AC19).
 *
 * A measurement is only ever taken when ALL of these hold: the card is open,
 * consent is on record, the stored figure is missing or older than 90 days,
 * and the browser's own connection hints permit it. Never on render, never
 * twice per mount, and a failure is silent — an automatic probe must not nag.
 */
import { useEffect, useRef } from 'react';
import type { ConnectionSpeedDto } from '@raid-ledger/contract';
import { canAutoRunSpeedTest, runSpeedTest } from '../lib/speedtest/ndt7-runner';
import { useSetConnectionSpeed } from './use-connection-speed';

/** 90 days — the age at which a stored figure stops being worth trusting. */
export const SPEED_FIGURE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1_000;

/** Whether the stored figure is missing or too old to reuse (E23). */
export function isSpeedFigureStale(
    speed: ConnectionSpeedDto | undefined,
    now: number = Date.now(),
): boolean {
    if (!speed || speed.downstreamMbps === null || !speed.measuredAt) return true;
    const measured = new Date(speed.measuredAt).getTime();
    if (Number.isNaN(measured)) return true;
    return now - measured > SPEED_FIGURE_MAX_AGE_MS;
}

/**
 * Run one measurement on card open when every guard passes.
 *
 * @param speed - the viewer's stored figure, if it has loaded
 * @param enabled - true once the card is actually on screen
 */
export function useAutoSpeedTest(
    speed: ConnectionSpeedDto | undefined,
    enabled: boolean,
): void {
    const save = useSetConnectionSpeed();
    const attempted = useRef(false);
    const saveRef = useRef(save);
    saveRef.current = save;
    useEffect(() => {
        if (!enabled || attempted.current) return;
        if (!speed?.consentAt || !isSpeedFigureStale(speed)) return;
        if (!canAutoRunSpeedTest().ok) return;
        attempted.current = true;
        void runSpeedTest()
            .then((downstreamMbps) =>
                saveRef.current.mutate({ downstreamMbps, source: 'ndt7' }),
            )
            .catch(() => undefined);
    }, [enabled, speed]);
}
