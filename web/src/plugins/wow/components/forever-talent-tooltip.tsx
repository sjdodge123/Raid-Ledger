/**
 * ROK-2150: a Forever talent's own tooltip — name, "Rank x/y", the spent rank's text and
 * the next rank's — from the static table's per-rank Wowhead calculator text. Replaces
 * Wowhead's spell tooltip, which shows one rank's numbers for every rank on Forever.
 * Portalled to `<body>` and placed by `useAnchoredPopup` (below the icon, flipped above
 * when it does not fit), with its left edge clamped inside the viewport.
 */
import { useRef, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPopup } from '../../../components/ui/use-anchored-popup';
import { Z_INDEX } from '../../../lib/z-index';
import { foreverTalentTooltipText } from '../lib/forever-talent-tooltip';
import type { JoinedTalent } from '../lib/forever-talent-table';

/** `w-64`, and the clearance kept from either viewport edge. */
const TIP_WIDTH_PX = 256;
const EDGE_PX = 8;

/** The tooltip's left edge: the anchor's, shifted left so the panel never leaves the viewport. */
function clampTooltipLeft(anchorLeft: number, viewportWidth: number): number {
    const width = Math.min(TIP_WIDTH_PX, viewportWidth - 2 * EDGE_PX);
    return Math.max(EDGE_PX, Math.min(anchorLeft, viewportWidth - EDGE_PX - width));
}

function TooltipBody({ talent }: { talent: JoinedTalent }) {
    const { current, next, shownRank } = foreverTalentTooltipText(talent);
    return (
        <>
            <p className="text-sm font-semibold text-foreground">{talent.name}</p>
            <p className="text-muted">{`Rank ${shownRank}/${talent.maxRank}`}</p>
            {current && <p data-testid="forever-talent-tooltip-current" className="mt-1.5 whitespace-pre-line text-foreground">{current}</p>}
            {next && (
                <div data-testid="forever-talent-tooltip-next" className="mt-1.5">
                    <p className="text-muted">Next rank:</p>
                    <p className="whitespace-pre-line text-foreground">{next}</p>
                </div>
            )}
        </>
    );
}

interface ForeverTalentTooltipProps {
    talent: JoinedTalent;
    id: string;
    anchorRef: RefObject<HTMLElement | null>;
    onOutside: () => void;
}

/** Mount only while open; hidden until the first measurement places it. */
export function ForeverTalentTooltip({ talent, id, anchorRef, onOutside }: ForeverTalentTooltipProps) {
    const popupRef = useRef<HTMLDivElement | null>(null);
    const pos = useAnchoredPopup(anchorRef, popupRef, true, onOutside);
    const style: CSSProperties = {
        position: 'fixed', zIndex: Z_INDEX.DROPDOWN,
        top: pos?.top ?? 0, left: clampTooltipLeft(pos?.left ?? 0, window.innerWidth),
        visibility: pos ? 'visible' : 'hidden',
    };
    return createPortal(
        <div ref={popupRef} id={id} role="tooltip" data-testid="forever-talent-tooltip" style={style}
            className="pointer-events-none w-64 max-w-[calc(100vw-1rem)] break-words rounded-md border border-edge-strong bg-panel p-2.5 text-xs shadow-lg">
            <TooltipBody talent={talent} />
        </div>,
        document.body,
    );
}
