/**
 * ROK-1874: §4.7 `warning` status banner on the create form opened from
 * "Lock this time" — the slot's yes-voters overflow the roster, so some will
 * be benched. Not dismissible: it goes away when the numbers stop
 * overflowing. It never names who is benched (the bench order is not
 * deterministic yet).
 */
import { useSchedulingOverflow, type SchedulingOverflowParams } from './use-scheduling-overflow';

export function SchedulingOverflowNotice(props: SchedulingOverflowParams) {
    const overflow = useSchedulingOverflow(props);
    if (!overflow) return null;
    const { rostered, cap, benched, voters, creatorVoted } = overflow;
    return (
        <div role="status" data-testid="scheduling-overflow-notice"
            className="rounded-lg border border-warning/30 bg-warning/10 p-4 space-y-2">
            <p className="text-warning font-semibold">More yes-votes than roster spots</p>
            <p className="text-foreground">
                {`${rostered} people will be signed up for this time, but the roster has ${cap} ${cap === 1 ? 'spot' : 'spots'} — ${benched} will go to the bench.`}
            </p>
            {!creatorVoted && (
                <p className="text-foreground">That count includes you — the organizer is always signed up.</p>
            )}
            {voters.length > 0 && (
                <p className="text-secondary break-words" data-testid="scheduling-overflow-voters">
                    {`Voted yes: ${voters.join(', ')}`}
                </p>
            )}
            <p className="text-secondary">
                Who goes to the bench depends on signup order. Raise the player count, or ask voters to change their vote before you create the event.
            </p>
        </div>
    );
}
