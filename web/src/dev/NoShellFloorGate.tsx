/**
 * ROK-1661 experiment gate, lazy-loaded by `Layout.tsx` only while the URL
 * carries `?noshellfloor=1` (`vpdebug-flag.ts`): reports whether the server is in
 * DEMO_MODE, the same check `ViewportReadout` makes, so the flag does nothing in
 * production. Reports false again on unmount (the flag left the URL).
 */
import { useEffect } from 'react';
import { useSystemStatus } from '../hooks/use-system-status';

export function NoShellFloorGate({ onDemoMode }: { onDemoMode: (demoMode: boolean) => void }) {
    const { data } = useSystemStatus();
    const demoMode = data?.demoMode === true;
    useEffect(() => {
        onDemoMode(demoMode);
        return () => onDemoMode(false);
    }, [demoMode, onDemoMode]);
    return null;
}
