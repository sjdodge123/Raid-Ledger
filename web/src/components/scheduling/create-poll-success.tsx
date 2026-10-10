/**
 * CreatePollSuccess (ROK-1750) — the create modal's success state for a
 * PRIVATE poll: it does not auto-navigate, it shows the share link (copy)
 * and an "Open poll" primary action. Public polls keep today's auto-navigate.
 */
import type { JSX } from 'react';
import { Button } from '../ui/button';
import { PollShareLink } from './poll-share-link';

export function CreatePollSuccess({ token }: { token: string }): JSX.Element {
    return (
        <div className="space-y-3" data-testid="create-poll-success">
            <p className="text-sm font-semibold text-foreground">Poll created</p>
            <p className="text-xs text-dim">
                Send this link to the people you want to vote. Anyone who opens it can see and vote on this poll.
            </p>
            <PollShareLink token={token} />
        </div>
    );
}

export function CreatePollSuccessFooter({ onOpen }: { onOpen: () => void }): JSX.Element {
    return (
        <Button variant="primary" size="lg" fullWidth onClick={onOpen}>
            Open poll
        </Button>
    );
}
