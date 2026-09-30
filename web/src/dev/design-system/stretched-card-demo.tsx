/**
 * Stretched-button card for /dev/design-system (docs/design-system.md §4.2, TDB:1949).
 *
 * A clickable card that holds its own controls: the card's action is the
 * `StretchedAction` primitive (`components/ui/stretched-action.tsx` — a native
 * button over the card and its 1px border, `absolute -inset-px`) as its FIRST
 * child, and the link, the secondary button and the titled badge are `relative`
 * and later in DOM order, so they paint and take clicks above it — no z-index,
 * no role="button" wrapper (axe `nested-interactive`). Same idiom as RosterSlot,
 * which raises PlayerCard's controls via `raiseControls`.
 * Tokens only, so it flips with the colour family.
 */
import { useState, type JSX } from 'react';
import { StretchedAction } from '../../components/ui/stretched-action';
import { StateFrame } from './design-system-bits';

export function StretchedCardDemo(): JSX.Element {
    const [last, setLast] = useState('nothing yet');
    return (
        <StateFrame
            label="Stretched-button card"
            note="Click the card, the name link, Remove, or hover the ⏳ badge. A click exactly on the raised badge is a dead zone (accepted trade-off)."
        >
            <div className="w-full space-y-2" data-testid="ds-stretched-card">
                <div className="relative flex items-center gap-3 rounded-lg border border-edge bg-panel/50 p-2.5 hover:bg-panel transition-colors">
                    <StretchedAction label="Manage tank slot 1 (Thrall)" onClick={() => setLast('card action')} />
                    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-overlay text-xs font-semibold text-secondary">T</span>
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <a href="#overlays" onClick={(e) => { e.preventDefault(); setLast('name link'); }}
                            className="relative truncate font-medium text-foreground hover:underline">Thrall</a>
                        <span className="relative cursor-default shrink-0 rounded-full bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning" title="Tentative — may not attend">&#x23F3;</span>
                    </div>
                    <button type="button" aria-label="Remove Thrall from slot" onClick={() => setLast('Remove')}
                        className="relative shrink-0 min-h-[44px] rounded px-3 text-xs text-dim hover:bg-danger/20 hover:text-danger transition-colors">Remove</button>
                </div>
                <p className="text-[10px] text-muted" aria-live="polite">Last click: {last}</p>
            </div>
        </StateFrame>
    );
}
