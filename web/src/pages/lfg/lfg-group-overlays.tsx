/**
 * ROK-1573/1572/1571 — every dialog the LFG group page opens, and the one
 * piece of state that says which. Only one overlay is ever open; the lock-in
 * confirm carries the window its row handed up.
 */
import { useState, type ComponentType, type JSX } from 'react';
import type { LfgGroupDetailDto, LfgMemberDto, LfgOverlapWindowDto } from '@raid-ledger/contract';
import type { LfgUrgencyPick } from '../../components/lfg/lfg-urgency-choice';
import { LfgLockInConfirm } from './LfgLockInConfirm';
import { lockInMembersLeft } from './lfg-dialog-recipes';
import { LfgManageDialog } from './LfgManageDialog';
import { LfgParticipantsList, type LfgMemberBadgesSlot } from './LfgParticipantsList';
import { LfgPollConfirm } from './LfgPollConfirm';
import { LfgStartNowConfirm } from './LfgStartNowConfirm';
import type { LfgOverlay } from './use-lfg-overlay';
import type { LfgGroupingContext, LfgLockInExtra, LfgLockInFieldsProps } from '../../plugins/lfg-grouping';

/** The writes the dialogs confirm; each takes the close to run when it lands. */
export interface LfgOverlayActions {
    startPoll: (done: () => void) => void;
    startNow: (done: () => void) => void;
    lockIn: (window: LfgOverlapWindowDto, done: () => void, extra?: LfgLockInExtra) => void;
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
    /** ROK-2352: the grouping plugin's lock-in fields, when one is active. */
    lockInFields?: LfgLockInSlot | undefined;
    /** ROK-2352: the grouping plugin's per-member badges, when one is active. */
    memberBadges?: LfgMemberBadgesSlot | undefined;
}

/** The active grouping's `LockInFields` and the page context. */
export interface LfgLockInSlot {
    Fields: ComponentType<LfgLockInFieldsProps>;
    context: LfgGroupingContext;
}

/** The lock-in confirm — mounted only while a row's window is being confirmed. */
function LockInDialog(props: LfgGroupOverlaysProps): JSX.Element | null {
    const { overlay } = props;
    if (overlay.kind !== 'lockin') return null;
    // Keyed so the plugin's pick (`extra`) and the opening roster live only as
    // long as THIS open dialog: a cancelled pick must never reach a later Confirm.
    return <OpenLockInDialog key={overlay.window.start} {...props} window={overlay.window} />;
}

/** How many of the members on the roster when the dialog opened have since left it. */
function membersLeft(openedIds: readonly number[], members: readonly LfgMemberDto[]): number {
    const now = new Set(members.map((m) => m.userId));
    return openedIds.filter((id) => !now.has(id)).length;
}

function OpenLockInDialog({ group, window, actions, onClose, lockInFields }: LfgGroupOverlaysProps & {
    window: LfgOverlapWindowDto;
}): JSX.Element {
    const [extra, setExtra] = useState<LfgLockInExtra>({});
    const [openedIds] = useState(() => group.members.map((m) => m.userId));
    const left = membersLeft(openedIds, group.members);
    const Fields = lockInFields?.Fields;
    return (
        <LfgLockInConfirm
            isOpen
            window={window}
            members={group.members}
            isPending={actions.isLockInPending}
            onCancel={onClose}
            onConfirm={() => actions.lockIn(window, onClose, extra)}
            extra={(
                <>
                    {left > 0 && (
                        <p data-testid="lfg-lockin-members-left" role="status" className="text-sm text-warning">
                            {lockInMembersLeft(left, group.groupLabel ?? group.gameName)}
                        </p>
                    )}
                    {Fields && lockInFields && <Fields context={lockInFields.context} group={group} onChange={setExtra} />}
                </>
            )}
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
                spawnsNow={group.pressWouldSpawnNow === true}
                spawnEmoji={group.spawnIndicatorEmoji}
            />
            <LfgParticipantsList isOpen={kind === 'participants'} members={group.members} onClose={onClose} badges={props.memberBadges} />
        </>
    );
}
