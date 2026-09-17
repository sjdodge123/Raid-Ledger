/**
 * ROK-1573/1572 — the LFG group page composition, fed fixtures.
 *
 * Same container and panel order as `lfg-group-page.tsx`. Real components:
 * `LfgHeader`, `LfgFullGroupPrompt`, `PendingPollCard`, `LfgHistoryPanel`,
 * `LfgConversationPanel` (threadId null → renders nothing, as shipped for a
 * group with no forum thread), `LfgSuggestionsPanel`. Dev variants: the status
 * bar and the overlap panel (their new buttons/labels are not props).
 */
import { useState, type JSX } from 'react';
import { LfgConversationPanel } from '../../pages/lfg/LfgConversationPanel';
import { LfgFullGroupPrompt } from '../../pages/lfg/LfgFullGroupPrompt';
import { LfgHeader } from '../../pages/lfg/LfgHeader';
import { LfgHistoryPanel } from '../../pages/lfg/LfgHistoryPanel';
import { LfgSuggestionsPanel } from '../../pages/lfg/LfgSuggestionsPanel';
import { PendingPollCard } from '../../pages/lfg/lfg-group-states';
import { WfOverlapPanel } from './WfOverlapPanel';
import { WfPollConfirm } from './WfPollConfirm';
import { WfStatusBar } from './WfStatusBar';
import { WF_COPY, type WfActionsLayout, type WfVariantId } from './wireframe-variants';
import { WfCreateEventContext } from './WfCreateEventContext';
import {
    WF_BEST_TIME_LABEL,
    WF_CONVERTED_EVENT,
    WF_GAME,
    WF_GAME_ID,
    WF_GROUP,
    WF_HISTORY,
    WF_OVERLAP,
    WF_OVERLAP_EMPTY,
    WF_SUGGESTIONS,
} from './wireframe-fixtures';

/** Per-variant knobs for the page. */
function configFor(variant: WfVariantId): { layout: WfActionsLayout; createLabel: string; emptyOverlap: boolean } {
    if (variant === 'L1b') return { layout: 'stacked', createLabel: `${WF_COPY.createEvent} · ${WF_BEST_TIME_LABEL}`, emptyOverlap: false };
    if (variant === 'L2') return { layout: 'poll-first', createLabel: WF_COPY.createEvent, emptyOverlap: true };
    return { layout: 'side', createLabel: WF_COPY.createEvent, emptyOverlap: false };
}

export interface WfLfgGroupPageProps {
    variant: WfVariantId;
    /** Create event's click target — the route jumps to L5. */
    onCreateEvent: () => void;
}

/** The whole page for one variant. */
export function WfLfgGroupPage({ variant, onCreateEvent }: WfLfgGroupPageProps): JSX.Element {
    const [confirmOpen, setConfirmOpen] = useState(variant === 'L3');
    if (variant === 'L5') return <WfCreateEventContext />;
    const cfg = configFor(variant);
    const openConfirm = (): void => setConfirmOpen(true);
    return (
        <div className="mx-auto max-w-4xl space-y-4 px-4 pt-6 pb-24 md:pb-6">
            <LfgHeader gameId={WF_GAME_ID} game={WF_GAME} fallbackName="PEAK" />
            <WfStatusBar
                group={WF_GROUP}
                layout={cfg.layout}
                createLabel={cfg.createLabel}
                convertedEvent={variant === 'L4' ? WF_CONVERTED_EVENT : null}
                onCreateEvent={onCreateEvent}
                onStartPoll={openConfirm}
            />
            <LfgFullGroupPrompt group={WF_GROUP} onFindATime={openConfirm} />
            <PendingPollCard pending={null} onRetry={() => undefined} />
            <div className="grid gap-4 md:grid-cols-2">
                <WfOverlapPanel overlap={cfg.emptyOverlap ? WF_OVERLAP_EMPTY : WF_OVERLAP} onStartPoll={openConfirm} />
                <LfgHistoryPanel history={WF_HISTORY} />
            </div>
            <LfgConversationPanel gameId={WF_GAME_ID} threadId={null} />
            <LfgSuggestionsPanel gameId={WF_GAME_ID} suggestions={WF_SUGGESTIONS} />
            <WfPollConfirm isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} members={WF_GROUP.members} />
        </div>
    );
}
