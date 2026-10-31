/**
 * ROK-1960 F4 — the cross-hub confirm's state. The server is the one source
 * of truth: the first bind is sent without `confirmCrossHub`, and a 409
 * `cross_hub_move` lands here via `hold(move, retry)`. Move here runs `retry`
 * (the bind again, with the flag, then the post); Cancel drops it and sends
 * nothing further.
 */
import { useRef, useState } from 'react';
import type { Bg3CrossHubMove } from '@raid-ledger/contract';

export interface Bg3MoveCheck {
    /** The 409 body while the sheet asks; `null` otherwise. */
    readonly confirm: Bg3CrossHubMove | null;
    readonly hold: (move: Bg3CrossHubMove, retry: () => void) => void;
    readonly cancel: () => void;
    readonly confirmMove: () => void;
}

export function useBg3MoveCheck(): Bg3MoveCheck {
    const [confirm, setConfirm] = useState<Bg3CrossHubMove | null>(null);
    const pending = useRef<(() => void) | null>(null);
    const hold = (move: Bg3CrossHubMove, retry: () => void): void => { pending.current = retry; setConfirm(move); };
    const cancel = (): void => { pending.current = null; setConfirm(null); };
    const confirmMove = (): void => { const go = pending.current; cancel(); go?.(); };
    return { confirm, hold, cancel, confirmMove };
}
