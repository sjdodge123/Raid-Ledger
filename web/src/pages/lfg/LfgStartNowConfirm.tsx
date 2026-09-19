/**
 * ROK-1613 — "Start playing right now?" confirm.
 *
 * Pattern REUSE of the approved `LfgPollConfirm` (ROK-1572, H4) and
 * `LfgLockInConfirm` (ROK-1573, H3): same sheet-or-modal shell, same member
 * list, same confirm actions. No new pattern is introduced.
 *
 * Pure props in, callbacks out. Cancel, Esc, a scrim click or a sheet swipe
 * all route to `onCancel` and make NO API call; only "Start now" confirms.
 *
 * The list shows the people who get INVITED — everyone but the starter (AC4).
 * Rostering them is the server's job to refuse, but showing them under a
 * sentence that says "they are asked, not signed up" is what makes the
 * difference visible before the press.
 */
import type { JSX } from 'react';
import type { LfgMemberDto } from '@raid-ledger/contract';
import { LFG_DIALOG_COPY, startNowBody } from './lfg-dialog-recipes';
import { LfgConfirmActions, LfgMemberList, LfgSheetOrModal } from './LfgSheetOrModal';

export interface LfgStartNowConfirmProps {
    isOpen: boolean;
    /** Live members MINUS the starter — exactly who receives an invite. */
    invitees: LfgMemberDto[];
    isPending?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

export function LfgStartNowConfirm({
    isOpen,
    invitees,
    isPending = false,
    onCancel,
    onConfirm,
}: LfgStartNowConfirmProps): JSX.Element | null {
    return (
        <LfgSheetOrModal isOpen={isOpen} onClose={onCancel} title={LFG_DIALOG_COPY.startNowTitle}>
            <div data-testid="lfg-start-now-confirm" className="space-y-3">
                <p className="text-sm text-muted">{startNowBody(invitees.length)}</p>
                <LfgMemberList members={invitees} rowTestId="lfg-start-now-confirm-member" />
                <LfgConfirmActions
                    primary={LFG_DIALOG_COPY.startNowSubmit}
                    testIdPrefix="lfg-start-now-confirm"
                    isPending={isPending}
                    onCancel={onCancel}
                    onConfirm={onConfirm}
                />
            </div>
        </LfgSheetOrModal>
    );
}
