/**
 * ROK-1573/1572/1571 — every dialog the LFG group page opens, and the one
 * piece of state that says which. Only one overlay is ever open; the lock-in
 * confirm carries the window its row handed up.
 */
import type { JSX } from 'react';
import type { LfgGroupDetailDto, LfgMemberDto, LfgOverlapWindowDto } from '@raid-ledger/contract';
import type { LfgUrgencyPick } from '../../components/lfg/lfg-urgency-choice';
import { LfgLockInConfirm } from './LfgLockInConfirm';
import { LfgManageDialog } from './LfgManageDialog';
import { LfgParticipantsList } from './LfgParticipantsList';
import { LfgPollConfirm } from './LfgPollConfirm';
import { LfgStartNowConfirm } from './LfgStartNowConfirm';
import type { LfgOverlay } from './use-lfg-overlay';

/** The writes the dialogs confirm; each takes the close to run when it lands. */
export interface LfgOverlayActions {
    startPoll: (done: () => void) => void;
    startNow: (done: () => void) => void;
    lockIn: (window: LfgOverlapWindowDto, done: () => void) => void;
    pickUrgency: (pick: LfgUrgencyPick, done: () => void) => void;
    withdraw: (done: () => void) => void;
    isPollPending: boolean;
    isStartNowPending: boolean;
    isLockInPending: boolean;
    isWithdrawing: boolean;
}

export interface LfgGroupOverlaysProps {
    group: LfgGroupDetailDto;
    overlay: LfgOverlay;
    actions: LfgOverlayActions;
    onClose: () => void;
}

/** The lock-in confirm — mounted only while a row's window is being confirmed. */
function LockInDialog({ group, overlay, actions, onClose }: LfgGroupOverlaysProps): JSX.Element | null {
    if (overlay.kind !== 'lockin') return null;
    const { window } = overlay;
    return (
        <LfgLockInConfirm
            isOpen
            window={window}
            members={group.members}
            isPending={actions.isLockInPending}
            onCancel={onClose}
            onConfirm={() => actions.lockIn(window, onClose)}
        />
    );
}

/**
 * The start-now confirm — ROK-1613. Mounted only while open, matching
 * `LockInDialog`, so the invitee list is derived on the renders that read it
 * rather than on every render of the overlay tree.
 */
function StartNowDialog({ group, overlay, actions, onClose }: LfgGroupOverlaysProps): JSX.Element | null {
    if (overlay.kind !== 'startnow') return null;
    // A `now` hand can lapse WHILE the confirm is open. Re-gate on the intent
    // rather than re-rendering with a different wrong sentence: without an
    // intent the body would claim nobody else is in the group, while the
    // server would still invite the members who are.
    if (group.ownIntent == null) return null;
    return (
        <LfgStartNowConfirm
            isOpen
            invitees={inviteesOf(group)}
            isPending={actions.isStartNowPending}
            onCancel={onClose}
            onConfirm={() => actions.startNow(onClose)}
        />
    );
}

/**
 * Who the start-now press INVITES: every live member but the starter (AC4).
 *
 * The starter is `ownIntent.userId` rather than the auth user, so the list is
 * derived from the same read that renders the roster. `StartNowDialog` unmounts
 * when the intent goes, so a starter-less group never reaches this.
 */
function inviteesOf(group: LfgGroupDetailDto): LfgMemberDto[] {
    const starterId = group.ownIntent?.userId;
    return group.members.filter((m) => m.userId !== starterId);
}

/** Mounts every dialog; `isOpen` decides which one shows. */
export function LfgGroupOverlays(props: LfgGroupOverlaysProps): JSX.Element {
    const { group, overlay: { kind }, actions, onClose } = props;
    return (
        <>
            <LfgPollConfirm
                isOpen={kind === 'poll'}
                members={group.members}
                isPending={actions.isPollPending}
                onCancel={onClose}
                onConfirm={() => actions.startPoll(onClose)}
            />
            <StartNowDialog {...props} />
            <LockInDialog {...props} />
            <LfgManageDialog
                isOpen={kind === 'manage'}
                gameName={group.gameName}
                ownUrgency={group.ownIntent?.urgency ?? null}
                onPickUrgency={(pick) => actions.pickUrgency(pick, onClose)}
                onWithdraw={() => actions.withdraw(onClose)}
                isWithdrawing={actions.isWithdrawing}
                onClose={onClose}
            />
            <LfgParticipantsList isOpen={kind === 'participants'} members={group.members} onClose={onClose} />
        </>
    );
}
