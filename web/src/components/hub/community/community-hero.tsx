/**
 * ROK-1870 §3.1 — the community hub's hero pills: the "Community hub" kind
 * chip (+ a warning chip while the hub is proposed/archived — only staff can
 * open such a page, A7), the leader line, and Join / Joined · Leave. Join is
 * disabled with the `joinBlockedReason` copy; a leader with other members
 * gets the transfer prompt instead of a Leave request (D13).
 */
import { useState, type JSX } from 'react';
import type { HubCtx } from '../../../plugins/hub-module';
import { Button } from '../../ui/button';
import { StatusChip } from '../../ui/status-chip';
import { joinBlockedCopy, leaveNeedsTransfer } from './community-access';
import { useCommunityJoin } from './community-hub-api';
import { useAuth } from '../../../hooks/use-auth';

const STATUS_LABEL = { proposed: 'Proposed', archived: 'Archived' } as const;

/** Kind chip, lifecycle chip and the leader's name. */
export function CommunityKindPill({ page }: HubCtx): JSX.Element | null {
    const c = page.community;
    if (c === undefined) return null;
    return (
        <span className="inline-flex flex-wrap items-center gap-2" data-testid="community-hub-kind">
            <StatusChip tone="neutral" title="A community hub for this game">Community hub</StatusChip>
            {c.status !== 'active' && (
                <StatusChip tone="warning" title={`This hub is ${c.status}`}>{STATUS_LABEL[c.status]}</StatusChip>
            )}
            {c.leader !== null && <span data-testid="community-hub-leader">Led by {c.leader.username}</span>}
        </span>
    );
}

function TransferPrompt({ onDismiss }: { onDismiss: () => void }): JSX.Element {
    return (
        <span role="status" className="inline-flex flex-wrap items-center gap-2 text-xs text-secondary" data-testid="community-hub-transfer-prompt">
            Transfer leadership before leaving — pick a new leader from the Members tab.
            <Button variant="ghost" size="sm" onClick={onDismiss}>OK</Button>
        </span>
    );
}

function LeaveConfirm({ onLeave, onCancel }: { onLeave: () => void; onCancel: () => void }): JSX.Element {
    return (
        <span className="inline-flex items-center gap-1" data-testid="community-hub-leave-confirm">
            <Button variant="destructive-soft" size="sm" data-testid="community-hub-leave-yes" onClick={onLeave}>Leave hub</Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        </span>
    );
}

type LeaveStep = 'idle' | 'confirm' | 'transfer';

/** Join, or — once joined — Leave behind a one-step confirm (or the transfer prompt for a leader). */
export function CommunityJoinPill({ page }: HubCtx): JSX.Element | null {
    const join = useCommunityJoin(page.guild.id);
    const [step, setStep] = useState<LeaveStep>('idle');
    const { user } = useAuth();
    const c = page.community;
    if (c === undefined) return null;
    if (!c.viewerJoined) {
        const blocked = joinBlockedCopy(c);
        return (
            <span className="inline-flex flex-wrap items-center gap-2">
                <Button variant="primary" size="sm" data-testid="community-hub-join" disabled={blocked !== null || join.isPending}
                    onClick={() => join.mutate(true)}>Join</Button>
                {blocked !== null && <span className="text-xs text-muted" data-testid="community-hub-join-blocked">{blocked}</span>}
            </span>
        );
    }
    if (step === 'transfer') return <TransferPrompt onDismiss={() => setStep('idle')} />;
    if (step === 'confirm') return <LeaveConfirm onCancel={() => setStep('idle')} onLeave={() => { setStep('idle'); join.mutate(false); }} />;
    return (
        <Button variant="secondary" size="sm" data-testid="community-hub-leave"
            onClick={() => setStep(leaveNeedsTransfer(page, user?.id ?? null) ? 'transfer' : 'confirm')}>Joined ✓ · Leave</Button>
    );
}
