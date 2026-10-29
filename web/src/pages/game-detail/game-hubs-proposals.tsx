/**
 * ROK-1870 (moved as-is by ROK-1883) — the Hubs card's "Your proposals" list
 * with Withdraw → Keep / Yes, withdraw, and the "Start a community hub"
 * footer with its disabled reason.
 */
import { useState, type JSX } from 'react';
import type { GameHubs, HubProposal } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { StatusChip } from '../../components/ui/status-chip';
import { useWithdrawProposal } from './use-game-hubs';

type BlockedReason = NonNullable<GameHubs['proposeBlockedReason']>;

/** Why "Start a community hub" is disabled. */
const PROPOSE_BLOCKED_COPY: Record<BlockedReason, string> = {
    'not-in-discord': 'Join the Discord server to start a hub.',
    'limit-reached': 'You already have two proposals waiting for review.',
    'pending-for-game': 'You already have a proposal waiting for this game.',
};

function ProposalRow({ proposal }: { proposal: HubProposal }): JSX.Element {
    const [confirming, setConfirming] = useState(false);
    const withdraw = useWithdrawProposal();
    return (
        <li className="flex flex-wrap items-center gap-3 py-2">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{proposal.name}</p>
            <StatusChip tone="warning" title="An admin has not reviewed it yet">Pending review</StatusChip>
            {confirming ? (
                <span className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Keep</Button>
                    <Button variant="destructive-soft" size="sm" loading={withdraw.isPending}
                        onClick={() => withdraw.mutate(proposal.id)}>Yes, withdraw</Button>
                </span>
            ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>Withdraw</Button>
            )}
        </li>
    );
}

/** The viewer's pending proposals; nothing when there are none. */
export function GameHubsProposals({ proposals }: { proposals: readonly HubProposal[] }): JSX.Element | null {
    if (proposals.length === 0) return null;
    return (
        <>
            <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">Your proposals</p>
            <ul className="divide-y divide-edge-subtle">
                {proposals.map((p) => <ProposalRow key={p.id} proposal={p} />)}
            </ul>
        </>
    );
}

/** "Start a community hub", disabled with the reason when the viewer may not propose. */
export function GameHubsStartFooter({ data, onStart }: { data: GameHubs; onStart: () => void }): JSX.Element {
    const reason = data.proposeBlockedReason;
    return (
        <div className="mt-3 space-y-1">
            <Button variant="secondary" onClick={onStart} disabled={!data.canPropose}
                aria-describedby={reason ? 'propose-blocked-reason' : undefined}>Start a community hub</Button>
            {!data.canPropose && reason && <p id="propose-blocked-reason" className="text-xs text-muted">{PROPOSE_BLOCKED_COPY[reason]}</p>}
        </div>
    );
}
