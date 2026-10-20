/**
 * ROK-1870 — the game page "Community hubs" card (spec §3.2): up to three
 * hubs with an inline Join, "See all N hubs" into the `/hubs` directory, the
 * viewer's pending proposals with Withdraw, and "Start a community hub".
 */
import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import type { GameHubs, HubDirectoryEntry, HubProposal } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { StatusChip } from '../../components/ui/status-chip';
import { useGameHubs, useJoinGameHub, useWithdrawProposal } from './use-game-hubs';
import { isHubMember } from './hub-join';
import { ProposeHubDialog } from './propose-hub-dialog';
import { memberCountLabel } from '../../components/layout/hub-nav/my-hubs-queries';

const SHOWN = 3;
type BlockedReason = NonNullable<GameHubs['proposeBlockedReason']>;

/** Why "Start a community hub" is disabled. */
const PROPOSE_BLOCKED_COPY: Record<BlockedReason, string> = {
    'not-in-discord': 'Join the Discord server to start a hub.',
    'limit-reached': 'You already have two proposals waiting for review.',
    'pending-for-game': 'You already have a proposal waiting for this game.',
};

function HubRow({ hub, onJoin, joining }: { hub: HubDirectoryEntry; onJoin: () => void; joining: boolean }): JSX.Element {
    return (
        <li className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
                <Link to={`/guilds/${hub.id}`} className="block truncate text-sm font-medium text-foreground hover:underline">{hub.name}</Link>
                {hub.blurb && <p className="truncate text-xs text-muted">{hub.blurb}</p>}
            </div>
            <span className="shrink-0 text-xs text-muted">{memberCountLabel(hub.memberCount)}</span>
            {isHubMember(hub) && <StatusChip tone="success" title="You are a member">Joined</StatusChip>}
            {hub.viewer === 'not-member' && (
                <Button variant="secondary" size="sm" onClick={onJoin} disabled={joining} aria-label={`Join ${hub.name}`}>Join</Button>
            )}
        </li>
    );
}

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

function HubList({ data, gameId, gameName }: { data: GameHubs; gameId: number; gameName: string }): JSX.Element {
    const join = useJoinGameHub(gameId);
    if (data.hubs.length === 0) {
        return <p className="mt-2 text-sm text-muted">No community hubs for {gameName} yet — start the first one.</p>;
    }
    return (
        <>
            <ul className="mt-1 divide-y divide-edge-subtle">
                {data.hubs.slice(0, SHOWN).map((h) => (
                    <HubRow key={h.id} hub={h} onJoin={() => join.mutate(h.id)} joining={join.isPending && join.variables === h.id} />
                ))}
            </ul>
            {data.hubs.length > SHOWN && (
                <Link to={`/hubs?game=${gameId}`} className="mt-1 inline-block text-sm text-secondary underline">See all {data.hubs.length} hubs</Link>
            )}
        </>
    );
}

function StartFooter({ data, onStart }: { data: GameHubs; onStart: () => void }): JSX.Element {
    const reason = data.proposeBlockedReason;
    return (
        <div className="mt-3 space-y-1">
            <Button variant="secondary" onClick={onStart} disabled={!data.canPropose}
                aria-describedby={reason ? 'propose-blocked-reason' : undefined}>Start a community hub</Button>
            {!data.canPropose && reason && <p id="propose-blocked-reason" className="text-xs text-muted">{PROPOSE_BLOCKED_COPY[reason]}</p>}
        </div>
    );
}

const FRAME = 'mb-8 rounded-lg border border-edge bg-surface p-4';

/** The card frame with a §4.5 error line when `/hubs/by-game` fails. */
function HubsCardError({ onRetry }: { onRetry: () => void }): JSX.Element {
    return (
        <section className={FRAME} aria-labelledby="community-hubs-heading">
            <h2 id="community-hubs-heading" className="text-lg font-semibold text-foreground">Community hubs</h2>
            <p role="alert" data-testid="community-hubs-error" className="mt-2 flex items-center gap-2 text-sm text-muted">
                Couldn’t load community hubs. <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>
            </p>
        </section>
    );
}

/** Core game-page section; renders nothing while loading, an error line on failure. */
export function CommunityHubsSection({ gameId, gameName }: { gameId: number; gameName: string }): JSX.Element | null {
    const { data, isError, refetch } = useGameHubs(gameId);
    const [open, setOpen] = useState(false);
    if (isError) return <HubsCardError onRetry={() => void refetch()} />;
    if (!data) return null;
    return (
        <section className={FRAME} aria-labelledby="community-hubs-heading">
            <h2 id="community-hubs-heading" className="text-lg font-semibold text-foreground">Community hubs</h2>
            <HubList data={data} gameId={gameId} gameName={gameName} />
            {data.myProposals.length > 0 && (
                <>
                    <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">Your proposals</p>
                    <ul className="divide-y divide-edge-subtle">
                        {data.myProposals.map((p) => <ProposalRow key={p.id} proposal={p} />)}
                    </ul>
                </>
            )}
            <StartFooter data={data} onStart={() => setOpen(true)} />
            <ProposeHubDialog isOpen={open} onClose={() => setOpen(false)} gameId={gameId} gameName={gameName} />
        </section>
    );
}
