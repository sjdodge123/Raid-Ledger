/**
 * ROK-1573/1572/1571 — the LFG group page composition, fed fixtures, in the
 * scheduling-poll hero language.
 *
 * Same container and panel order as `lfg-group-page.tsx`, with the status bar
 * AND `LfgFullGroupPrompt` replaced by ONE {@link WfLfgHero}. Real components:
 * `LfgHeader`, `JourneyHero`, `PendingPollCard`, `LfgHistoryPanel`,
 * `LfgConversationPanel` (threadId null → renders nothing, as shipped for a
 * group with no forum thread), `LfgSuggestionsPanel`. Dev: the overlap panel
 * (its row label is a constant), the Participants chip/list and the dialogs.
 */
import { useState, type JSX } from 'react';
import type { LfgGroupDetailDto, LfgOverlapWindowDto } from '@raid-ledger/contract';
import { LfgConversationPanel } from '../../pages/lfg/LfgConversationPanel';
import { LfgHeader } from '../../pages/lfg/LfgHeader';
import { LfgHistoryPanel } from '../../pages/lfg/LfgHistoryPanel';
import { LfgSuggestionsPanel } from '../../pages/lfg/LfgSuggestionsPanel';
import { PendingPollCard } from '../../pages/lfg/lfg-group-states';
import { WfLfgHero } from './WfLfgHero';
import { WfOverlapPanel } from './WfOverlapPanel';
import { WfLockInDialog, WfManageDialog, WfPollDialog } from './WfOverlays';
import { WfParticipantsList } from './WfParticipants';
import type { WfVariantId } from './wireframe-variants';
import {
    rangeLabel,
    WF_GAME,
    WF_GAME_ID,
    WF_GROUP,
    WF_GROUP_LOOKING,
    WF_HISTORY,
    WF_OVERLAP,
    WF_OVERLAP_EMPTY,
    WF_SUGGESTIONS,
} from './wireframe-fixtures';

type Overlay = 'none' | 'manage' | 'lockin' | 'poll' | 'participants';

const OPEN_ON: Partial<Record<WfVariantId, Overlay>> = { H2: 'manage', H3: 'lockin', H4: 'poll', H5: 'participants' };

const FIRST_WINDOW = WF_OVERLAP.windows[0];

/** H6's event — the first shared time, everyone in it signed up. */
const LOCKED_EVENT = { label: rangeLabel(FIRST_WINDOW.start, FIRST_WINDOW.end), signupCount: FIRST_WINDOW.members.length };

export interface WfLfgGroupPageProps {
    variant: WfVariantId;
    /** Tab jump — Lock in lands on H6. */
    onVariant: (id: WfVariantId) => void;
}

/** Every dialog the page opens; only the active one mounts. */
function Dialogs({ group, overlay, lockWindow, onClose, onLocked }: {
    group: LfgGroupDetailDto; overlay: Overlay; lockWindow: LfgOverlapWindowDto;
    onClose: () => void; onLocked: () => void;
}): JSX.Element {
    return (
        <>
            <WfManageDialog group={group} isOpen={overlay === 'manage'} onClose={onClose} />
            <WfLockInDialog group={group} window={lockWindow} isOpen={overlay === 'lockin'} onClose={onClose} onConfirm={onLocked} />
            <WfPollDialog group={group} isOpen={overlay === 'poll'} onClose={onClose} />
            <WfParticipantsList group={group} isOpen={overlay === 'participants'} onClose={onClose} />
        </>
    );
}

/** The whole page for one tab. */
export function WfLfgGroupPage({ variant, onVariant }: WfLfgGroupPageProps): JSX.Element {
    const [overlay, setOverlay] = useState<Overlay>(OPEN_ON[variant] ?? 'none');
    const [lockWindow, setLockWindow] = useState<LfgOverlapWindowDto>(FIRST_WINDOW);
    const group = variant === 'H7' ? WF_GROUP_LOOKING : WF_GROUP;
    const event = variant === 'H6' ? LOCKED_EVENT : null;
    const lockIn = (w: LfgOverlapWindowDto): void => {
        setLockWindow(w);
        setOverlay('lockin');
    };
    return (
        <div className="mx-auto max-w-4xl space-y-4 px-4 pt-6 pb-24 md:pb-6">
            <LfgHeader gameId={WF_GAME_ID} game={WF_GAME} fallbackName="PEAK" />
            <WfLfgHero
                group={group}
                event={event}
                onPrimary={() => (event ? undefined : setOverlay('poll'))}
                onManage={() => setOverlay('manage')}
                onParticipants={() => setOverlay('participants')}
            />
            <PendingPollCard pending={null} onRetry={() => undefined} />
            <div className="grid gap-4 md:grid-cols-2">
                <WfOverlapPanel overlap={variant === 'H7' ? WF_OVERLAP_EMPTY : WF_OVERLAP} onLockIn={lockIn} />
                <LfgHistoryPanel history={WF_HISTORY} />
            </div>
            <LfgConversationPanel gameId={WF_GAME_ID} threadId={null} />
            <LfgSuggestionsPanel gameId={WF_GAME_ID} suggestions={WF_SUGGESTIONS} />
            <Dialogs group={group} overlay={overlay} lockWindow={lockWindow} onClose={() => setOverlay('none')} onLocked={() => onVariant('H6')} />
        </div>
    );
}
