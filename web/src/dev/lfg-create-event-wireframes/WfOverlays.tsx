/**
 * ROK-1573/1572 — the three action dialogs the LFG hero and time rows open:
 * Manage ⋯ (H2), Lock in this event (H3), Start a scheduling poll (H4).
 *
 * All three sit in {@link WfSheetOrModal} (BottomSheet + SheetTitleRow on
 * phones, Modal from 768px). Manage rows use the shipped scheduling sheet-row
 * recipe; the urgency choice is the REAL `LfgUrgencyChoice`.
 */
import type { JSX } from 'react';
import type { LfgGroupDetailDto, LfgMemberDto, LfgOverlapWindowDto } from '@raid-ledger/contract';
import { LfgUrgencyChoice } from '../../components/lfg/lfg-urgency-choice';
import { SCHEDULING_SHEET_ROW_DANGER } from '../../components/lineups/cycle-4/scheduling-action-button';
import { LFG_COPY } from '../../pages/lfg/lfg-copy';
import { rangeLabel } from './wireframe-fixtures';
import { CONFIRM_PRIMARY_BTN, SECONDARY_BTN } from './wireframe-variants';
import { WfMemberRow, WfSheetOrModal } from './WfSheetOrModal';

interface DialogProps {
    isOpen: boolean;
    onClose: () => void;
}

/** Cancel + primary, right-aligned; full-width equal columns on a phone. */
function ConfirmActions({ primary, onClose, onConfirm }: { primary: string; onClose: () => void; onConfirm: () => void }): JSX.Element {
    return (
        <div className="flex gap-2 pt-2 lg:justify-end">
            <button type="button" className={SECONDARY_BTN} onClick={onClose}>Cancel</button>
            <button type="button" className={CONFIRM_PRIMARY_BTN} onClick={onConfirm}>{primary}</button>
        </div>
    );
}

/** The members list a confirm names. */
function MemberList({ members }: { members: LfgMemberDto[] }): JSX.Element {
    return (
        <ul className="space-y-2">
            {members.map((m) => <WfMemberRow key={m.userId} member={m} />)}
        </ul>
    );
}

/** H2 — Manage ⋯: when you want to play, then Withdraw (no longer a standalone button). */
export function WfManageDialog({ group, isOpen, onClose }: DialogProps & { group: LfgGroupDetailDto }): JSX.Element | null {
    const nowIn = group.ownIntent?.urgency === 'now';
    return (
        <WfSheetOrModal isOpen={isOpen} onClose={onClose} title="Manage">
            <div data-testid="wf-manage-body" className="space-y-3">
                <div className="space-y-2 px-3">
                    <p className="text-sm font-medium text-foreground">{LFG_COPY.urgencyPrompt}</p>
                    <p className="text-xs text-muted">{`You're in · ${nowIn ? 'Right now' : LFG_COPY.urgencyWeek}. Pick again to change it.`}</p>
                    <div className="[&_button]:min-h-[44px] lg:[&_button]:min-h-0">
                        <LfgUrgencyChoice label={group.gameName} onPick={onClose} />
                    </div>
                </div>
                <div className="border-t border-edge pt-1">
                    <button type="button" className={SCHEDULING_SHEET_ROW_DANGER} onClick={onClose}>
                        <span>{LFG_COPY.withdraw}</span>
                        <span className="text-xs font-normal text-muted">Leave the group</span>
                    </button>
                </div>
            </div>
        </WfSheetOrModal>
    );
}

/** H3 — lock the group into an event at one shared time. */
export function WfLockInDialog({ group, window, isOpen, onClose, onConfirm }: DialogProps & {
    group: LfgGroupDetailDto; window: LfgOverlapWindowDto; onConfirm: () => void;
}): JSX.Element | null {
    const members = group.members.filter((m) => window.members.includes(m.userId));
    return (
        <WfSheetOrModal isOpen={isOpen} onClose={onClose} title="Lock in this event?">
            <div data-testid="wf-lockin-confirm" className="space-y-3">
                <p className="text-sm text-foreground">
                    <span className="font-semibold">{rangeLabel(window.start, window.end)}</span>
                    <span className="text-muted">{` · these ${members.length} get signed up and a Discord card.`}</span>
                </p>
                <MemberList members={members} />
                <ConfirmActions primary="Lock in" onClose={onClose} onConfirm={onConfirm} />
            </div>
        </WfSheetOrModal>
    );
}

/** H4 — start a scheduling poll for everyone looking. */
export function WfPollDialog({ group, isOpen, onClose }: DialogProps & { group: LfgGroupDetailDto }): JSX.Element | null {
    return (
        <WfSheetOrModal isOpen={isOpen} onClose={onClose} title="Start a scheduling poll?">
            <div data-testid="wf-poll-confirm" className="space-y-3">
                <p className="text-sm text-muted">
                    {`These ${group.members.length} people get a Discord card and a vote on times. You land on the poll next.`}
                </p>
                <MemberList members={group.members} />
                <ConfirmActions primary="Start poll" onClose={onClose} onConfirm={onClose} />
            </div>
        </WfSheetOrModal>
    );
}
