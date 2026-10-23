/**
 * ROK-1893 P3 — "Open polls" on a community hub's Events tab (approved
 * wireframe `HubPollsFrames` → `EventsTab`): the hub's open scheduling polls,
 * each with its visibility chip, and "New poll" for live members, which opens
 * CreatePollModal locked to the hub's game and tagged to the hub. Mounted via
 * the community hub module's `eventsLead` slot (that module's chunk, never the
 * hub page's); the modal loads on demand.
 */
import { useAuth } from '../../../hooks/use-auth';
import { canCreateHubPoll } from './hub-polls.helpers';
import { lazy, Suspense, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import type { ActiveStandalonePollDto } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { StatusChip } from '../../ui/status-chip';
import type { HubCtx } from '../../../plugins/hub-module';
import { useHubPolls } from './hub-polls-api';

const CreatePollModal = lazy(() => import('../../scheduling/create-poll-modal').then((m) => ({ default: m.CreatePollModal })));

export interface HubPollsSectionProps {
    hubId: number;
    hubName: string;
    gameId: number;
    /** Live members may start a poll (the API re-checks). */
    canCreate: boolean;
}

function PollRow({ poll }: { poll: ActiveStandalonePollDto }): JSX.Element {
    const label = poll.visibility === 'private' ? 'Link only' : 'Public';
    const times = poll.slotCount === 1 ? '1 time' : `${poll.slotCount} times`;
    return (
        <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-testid="hub-poll-row">
            <div className="min-w-0">
                <Link to={`/community-lineup/${poll.lineupId}/schedule/${poll.matchId}`}
                    className="block truncate text-sm font-medium text-foreground hover:underline">{poll.gameName}</Link>
                <p className="text-xs text-muted">{times} · {poll.memberCount} invited</p>
            </div>
            <StatusChip tone="neutral" title={`Visibility: ${label}`}>{label}</StatusChip>
        </li>
    );
}

function PollList({ hubId }: { hubId: number }): JSX.Element {
    const { data: polls, isLoading, error } = useHubPolls(hubId);
    if (isLoading) return <div aria-busy="true" className="h-14 animate-pulse rounded-lg border border-edge bg-surface" />;
    if (error) return <p className="text-sm text-muted">We couldn&apos;t load this hub&apos;s polls. Try again in a moment.</p>;
    if (!polls || polls.length === 0) return <p className="text-sm text-muted" data-testid="hub-polls-empty">No open polls yet.</p>;
    return (
        <ul className="divide-y divide-edge-subtle rounded-lg border border-edge bg-surface">
            {polls.map((p) => <PollRow key={p.matchId} poll={p} />)}
        </ul>
    );
}

export function HubPollsSection({ hubId, hubName, gameId, canCreate }: HubPollsSectionProps): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <section className="space-y-3" data-testid="hub-polls-section" aria-labelledby="hub-polls-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="hub-polls-heading" className="text-sm font-semibold text-foreground">Open polls</h2>
                {canCreate && <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>New poll</Button>}
            </div>
            <PollList hubId={hubId} />
            {open && (
                <Suspense fallback={null}>
                    <CreatePollModal isOpen onClose={() => setOpen(false)} initialGameId={gameId} hubId={hubId} hubName={hubName} />
                </Suspense>
            )}
        </section>
    );
}

/** The community module's `eventsLead` slot: this hub's polls; live members and staff get "New poll". */
export function CommunityHubPolls({ page }: HubCtx): JSX.Element {
    const { guild } = page;
    const { user } = useAuth();
    return <HubPollsSection hubId={guild.id} hubName={guild.name} gameId={guild.gameId} canCreate={canCreateHubPoll(page.community?.viewerJoined === true, user)} />;
}
