/**
 * ROK-1893 P3 — the hub block on a hub-tagged poll page (approved wireframe
 * `HubPollsFrames` → `PollPage`): a "Hub: <name>" line linking the hub, the
 * voters as chips with a "Member" mark for live hub members, and — for a
 * signed-in viewer who isn't a member — a Join hub card that uses the hub's
 * own join mutation and then refetches this poll. Renders nothing on an
 * untagged poll (or one whose hub is hidden — the API sends `hub: null`).
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { StatusChip } from '../../ui/status-chip';
import { useAuth } from '../../../hooks/use-auth';
import { schedulePollKey } from '../../../hooks/use-scheduling';
import { useCommunityJoin } from '../../hub/community/community-hub-api';
import { uniqueVoters, type Voter } from './scheduling-hub.helpers';

type PollHub = NonNullable<SchedulePollPageResponseDto['hub']>;

function VoterChips({ voters }: { voters: Voter[] }): JSX.Element | null {
    if (voters.length === 0) return null;
    return (
        <ul className="flex flex-wrap gap-2" aria-label="Voters" data-testid="scheduling-hub-voters">
            {voters.map((v) => (
                <li key={v.userId} className="flex items-center gap-1 rounded-full border border-edge bg-panel px-2 py-1 text-xs text-secondary">
                    {v.displayName}
                    {v.isHubMember === true && <StatusChip tone="neutral" title={`${v.displayName} is a hub member`}>Member</StatusChip>}
                </li>
            ))}
        </ul>
    );
}

function JoinHubCard({ hub, voted, onJoined }: { hub: PollHub; voted: boolean; onJoined: () => void }): JSX.Element {
    const join = useCommunityJoin(hub.id);
    const lead = voted ? 'You voted. ' : '';
    return (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge bg-surface p-3" data-testid="scheduling-hub-join">
            <p className="text-sm text-secondary">{lead}Join {hub.name} to hear about its next events.</p>
            <Button size="sm" loading={join.isPending} loadingLabel="Joining…" onClick={() => join.mutate(true, { onSuccess: onJoined })}>Join hub</Button>
        </div>
    );
}

export function SchedulingHubPanel({ poll, lineupId, matchId }: {
    poll: SchedulePollPageResponseDto; lineupId: number; matchId: number;
}): JSX.Element | null {
    const { user } = useAuth();
    const qc = useQueryClient();
    const hub = poll.hub;
    if (!hub) return null;
    const voters = uniqueVoters(poll.slots);
    const voted = user ? voters.some((v) => v.userId === user.id) : false;
    const refetch = (): void => { void qc.invalidateQueries({ queryKey: schedulePollKey(lineupId, matchId) }); };
    return (
        <div className="space-y-2" data-testid="scheduling-hub-panel">
            <p className="text-xs text-muted">
                Hub: <Link to={`/hubs/${hub.id}`} className="text-foreground underline hover:no-underline">{hub.name}</Link>
            </p>
            <VoterChips voters={voters} />
            {user && !hub.viewerIsMember && <JoinHubCard hub={hub} voted={voted} onJoined={refetch} />}
        </div>
    );
}
