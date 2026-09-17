/**
 * ROK-1572 (approved H4) — "Start a scheduling poll?" confirm.
 *
 * Pure props in, callbacks out. Cancel, Esc, a scrim click or a sheet swipe
 * all route to `onCancel` — the caller makes NO API call on those (1572-AC2);
 * only "Start poll" calls `onConfirm`.
 */
import type { JSX } from 'react';
import type { LfgMemberDto } from '@raid-ledger/contract';
import { LFG_DIALOG_COPY, pollBody } from './lfg-dialog-recipes';
import { LfgConfirmActions, LfgMemberList, LfgSheetOrModal } from './LfgSheetOrModal';

export interface LfgPollConfirmProps {
    isOpen: boolean;
    /** Everyone the poll's Discord card goes to (live members plus the viewer). */
    members: LfgMemberDto[];
    isPending?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

export function LfgPollConfirm({ isOpen, members, isPending = false, onCancel, onConfirm }: LfgPollConfirmProps): JSX.Element | null {
    return (
        <LfgSheetOrModal isOpen={isOpen} onClose={onCancel} title={LFG_DIALOG_COPY.pollTitle}>
            <div data-testid="lfg-poll-confirm" className="space-y-3">
                <p className="text-sm text-muted">{pollBody(members.length)}</p>
                <LfgMemberList members={members} rowTestId="lfg-poll-confirm-member" />
                <LfgConfirmActions
                    primary={LFG_DIALOG_COPY.pollSubmit}
                    testIdPrefix="lfg-poll-confirm"
                    isPending={isPending}
                    onCancel={onCancel}
                    onConfirm={onConfirm}
                />
            </div>
        </LfgSheetOrModal>
    );
}
