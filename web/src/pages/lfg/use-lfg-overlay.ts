/**
 * ROK-1573 — which LFG group page dialog is open. Only one ever is; the
 * lock-in confirm carries the window its overlap row handed up.
 */
import { useState } from 'react';
import type { LfgOverlapWindowDto } from '@raid-ledger/contract';

export type LfgOverlay =
    | { kind: 'none' }
    | { kind: 'poll' }
    | { kind: 'startnow' }
    | { kind: 'manage' }
    | { kind: 'participants' }
    | { kind: 'lockin'; window: LfgOverlapWindowDto };

const CLOSED: LfgOverlay = { kind: 'none' };

/** Which overlay is open, plus the setters the page hands its buttons. */
export function useLfgOverlay() {
    const [overlay, setOverlay] = useState<LfgOverlay>(CLOSED);
    return {
        overlay,
        open: (kind: 'poll' | 'startnow' | 'manage' | 'participants') => setOverlay({ kind }),
        openLockIn: (window: LfgOverlapWindowDto) => setOverlay({ kind: 'lockin', window }),
        close: () => setOverlay(CLOSED),
    };
}
