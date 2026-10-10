/**
 * PollShareLink (ROK-1750) — a private poll's read-only share link + Copy.
 * Same layout as the event invite link (`events/invite-modal.tsx`
 * `InviteLinkDisplay`): a selectable read-only field on `bg-surface` with the
 * copy action beside it; copy goes through `copyWithToast`. No new pattern.
 */
import type { JSX } from 'react';
import { LinkIcon } from '@heroicons/react/24/outline';
import { pollShareUrl, copyPollShareLink } from '../../lib/poll-share-redirect';

export function PollShareLink({ token }: { token: string }): JSX.Element {
    const url = pollShareUrl(token);
    return (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-surface border border-edge" data-testid="poll-share-link">
            <input type="text" readOnly value={url} aria-label="Poll share link"
                className="flex-1 min-w-0 bg-transparent text-xs text-foreground border-none rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-success/80"
                onClick={(e) => (e.target as HTMLInputElement).select()} />
            <button type="button" onClick={() => copyPollShareLink(token)}
                className="shrink-0 inline-flex items-center gap-1 min-h-[32px] px-2.5 text-xs text-muted hover:text-foreground rounded border border-edge/50 hover:bg-overlay/50 transition-colors">
                <LinkIcon className="w-4 h-4" aria-hidden="true" />
                Copy link
            </button>
        </div>
    );
}
