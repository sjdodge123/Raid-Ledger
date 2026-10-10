/**
 * PollShareLink (ROK-1750) — a private poll's read-only share link + Copy.
 * Same layout as the event invite link (`events/invite-modal.tsx`
 * `InviteLinkDisplay`): a selectable read-only field on `bg-surface` with the
 * copy action beside it; copy goes through `copyWithToast`. No new pattern —
 * the field and button are the `Input` / `Button` primitives (ROK-1646 guard).
 */
import type { JSX } from 'react';
import { LinkIcon } from '@heroicons/react/24/outline';
import { pollShareUrl, copyPollShareLink } from '../../lib/poll-share-redirect';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

export function PollShareLink({ token }: { token: string }): JSX.Element {
    const url = pollShareUrl(token);
    return (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-surface border border-edge" data-testid="poll-share-link">
            <div className="flex-1 min-w-0">
                <Input type="text" readOnly value={url} aria-label="Poll share link" fieldSize="sm"
                    onClick={(e) => (e.target as HTMLInputElement).select()} />
            </div>
            <Button variant="secondary" size="sm" className="shrink-0" onClick={() => copyPollShareLink(token)}>
                <LinkIcon className="w-4 h-4" aria-hidden="true" />
                Copy link
            </Button>
        </div>
    );
}
