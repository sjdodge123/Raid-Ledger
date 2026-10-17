/**
 * PhaseTransitionModal (ROK-1123).
 *
 * Confirm/cancel modal for the lineup phase-advance breadcrumb. Replaces
 * the previous two-click-within-3s pattern. Title and body adapt to the
 * specific transition (e.g. building→voting vs decided→voting).
 */
import { type FormEvent, type JSX } from 'react';
import type { LineupStatusDto } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { PHASE_LABELS } from './lineup-phases';

interface Props {
    fromStatus: LineupStatusDto;
    toStatus: LineupStatusDto;
    isPending: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

interface TransitionCopy {
    title: string;
    body: string;
    confirmLabel: string;
    pendingLabel: string;
}

const FORWARD_BODIES: Record<string, string> = {
    'building->voting':
        'Nominations will close and voting will open for all participants. Members will be notified.',
    'voting->decided':
        'Voting will close and the winning game will be locked in. A scheduling poll opens for participants.',
    'decided->archived':
        'The lineup will be closed and moved to history. No further changes can be made.',
};

const REVERSE_BODIES: Record<string, string> = {
    'voting->building':
        'Voting will be cancelled and the lineup will reopen for nominations. Existing votes will be discarded.',
    'decided->voting':
        'The decided game will be cleared and voting will reopen. Participants can change their votes.',
    'archived->decided':
        'The lineup will be reactivated in the Scheduling phase.',
};

function getTransitionCopy(
    fromStatus: LineupStatusDto,
    toStatus: LineupStatusDto,
): TransitionCopy {
    const fromIdx = phaseIndex(fromStatus);
    const toIdx = phaseIndex(toStatus);
    const isAdvance = toIdx > fromIdx;
    const key = `${fromStatus}->${toStatus}`;
    const targetLabel = PHASE_LABELS[toStatus];
    const verb = isAdvance ? 'Advance' : 'Revert';
    const body = isAdvance
        ? (FORWARD_BODIES[key] ?? '')
        : (REVERSE_BODIES[key] ?? '');
    return {
        title: `${verb} to ${targetLabel}?`,
        body,
        confirmLabel: `${verb} to ${targetLabel}`,
        pendingLabel: isAdvance ? 'Advancing...' : 'Reverting...',
    };
}

function phaseIndex(status: LineupStatusDto): number {
    return ['building', 'voting', 'decided', 'archived'].indexOf(status);
}

function ModalFooter({
    onCancel,
    isPending,
    confirmLabel,
    pendingLabel,
}: {
    onCancel: () => void;
    isPending: boolean;
    confirmLabel: string;
    pendingLabel: string;
}): JSX.Element {
    return (
        <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button variant="primary" type="submit" autoFocus loading={isPending} loadingLabel={pendingLabel}>
                {confirmLabel}
            </Button>
        </div>
    );
}

export function PhaseTransitionModal({
    fromStatus,
    toStatus,
    isPending,
    onCancel,
    onConfirm,
}: Props): JSX.Element {
    const copy = getTransitionCopy(fromStatus, toStatus);

    function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (isPending) return;
        onConfirm();
    }

    return (
        <Modal isOpen={true} onClose={onCancel} title={copy.title}>
            <form onSubmit={handleSubmit} className="space-y-4">
                {copy.body && <p className="text-sm text-foreground">{copy.body}</p>}
                <ModalFooter
                    onCancel={onCancel}
                    isPending={isPending}
                    confirmLabel={copy.confirmLabel}
                    pendingLabel={copy.pendingLabel}
                />
            </form>
        </Modal>
    );
}
