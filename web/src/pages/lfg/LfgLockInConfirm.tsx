/**
 * ROK-1573 (approved H3) — "Lock in this event?" confirm for one shared time.
 *
 * Operator ruling (review): Lock in signs up EVERYONE in the group, so the
 * body names all of them and marks the ones not free in that window. The range
 * is the event's — capped at 3 hours (`capLockInWindow`). Pure props in,
 * callbacks out: the caller creates the event on `onConfirm`.
 */
import type { JSX } from 'react';
import type { LfgMemberDto, LfgOverlapWindowDto } from '@raid-ledger/contract';
import { LFG_DIALOG_COPY, lockInBody } from './lfg-dialog-recipes';
import { capLockInWindow, formatWindowRange } from './overlap-strip.helpers';
import { LfgConfirmActions, LfgMemberRow, LfgSheetOrModal } from './LfgSheetOrModal';

export interface LfgLockInConfirmProps {
    isOpen: boolean;
    window: LfgOverlapWindowDto;
    /** The group's members — all of them get signed up. */
    members: LfgMemberDto[];
    isPending?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

/** Every member; the ones outside `window.members` read "not free then". */
function MemberRows({ members, freeIds }: { members: LfgMemberDto[]; freeIds: number[] }): JSX.Element {
    return (
        <ul className="space-y-2">
            {members.map((m) => (
                <LfgMemberRow
                    key={m.userId}
                    member={m}
                    testId="lfg-lockin-member"
                    trailing={freeIds.includes(m.userId) ? undefined : (
                        <span data-testid="lfg-lockin-not-free" className="shrink-0 text-xs text-muted">
                            {LFG_DIALOG_COPY.notFreeThen}
                        </span>
                    )}
                />
            ))}
        </ul>
    );
}

export function LfgLockInConfirm({ isOpen, window, members, isPending = false, onCancel, onConfirm }: LfgLockInConfirmProps): JSX.Element | null {
    return (
        <LfgSheetOrModal isOpen={isOpen} onClose={onCancel} title={LFG_DIALOG_COPY.lockInTitle}>
            <div data-testid="lfg-lockin-confirm" className="space-y-3">
                <p className="text-sm text-foreground">
                    <span className="font-semibold">{formatWindowRange(capLockInWindow(window))}</span>
                    <span className="text-muted">{lockInBody(members.length)}</span>
                </p>
                <MemberRows members={members} freeIds={window.members} />
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
