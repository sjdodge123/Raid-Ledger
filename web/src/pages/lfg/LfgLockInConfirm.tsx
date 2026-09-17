/**
 * ROK-1573 (approved H3) — "Lock in this event?" confirm for one shared time.
 *
 * Names the range and the members free in it. Pure props in, callbacks out:
 * the caller creates the event on `onConfirm` and does nothing on `onCancel`.
 */
import type { JSX } from 'react';
import type { LfgMemberDto, LfgOverlapWindowDto } from '@raid-ledger/contract';
import { LFG_DIALOG_COPY, lockInBody } from './lfg-dialog-recipes';
import { formatWindowRange } from './overlap-strip.helpers';
import { LfgConfirmActions, LfgMemberList, LfgSheetOrModal } from './LfgSheetOrModal';

export interface LfgLockInConfirmProps {
    isOpen: boolean;
    window: LfgOverlapWindowDto;
    /** The group's members; filtered here to the ones in `window.members`. */
    members: LfgMemberDto[];
    isPending?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

export function LfgLockInConfirm({ isOpen, window, members, isPending = false, onCancel, onConfirm }: LfgLockInConfirmProps): JSX.Element | null {
    const inWindow = members.filter((m) => window.members.includes(m.userId));
    return (
        <LfgSheetOrModal isOpen={isOpen} onClose={onCancel} title={LFG_DIALOG_COPY.lockInTitle}>
            <div data-testid="lfg-lockin-confirm" className="space-y-3">
                <p className="text-sm text-foreground">
                    <span className="font-semibold">{formatWindowRange(window)}</span>
                    <span className="text-muted">{lockInBody(inWindow.length)}</span>
                </p>
                <LfgMemberList members={inWindow} />
                <LfgConfirmActions
                    primary={LFG_DIALOG_COPY.lockInSubmit}
                    testIdPrefix="lfg-lockin-confirm"
                    isPending={isPending}
                    onCancel={onCancel}
                    onConfirm={onConfirm}
                />
            </div>
        </LfgSheetOrModal>
    );
}
