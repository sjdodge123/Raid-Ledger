/**
 * ROK-1750: the cards `/p/poll/:token` renders — the signed-out preview
 * (game cover + name, who invited you, Open/Closed, Sign in with Discord),
 * the invalid-link card and the can't-join card. Tokens only.
 */
import type { JSX, ReactNode } from 'react';
import type { PollSharePreviewDto } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';

export const INVALID_LINK_COPY = 'This link is no longer valid — ask whoever sent it for a new one.';
export const CANT_JOIN_COPY = "You can't join this poll with this account.";

function ShareCardShell({ children }: { children: ReactNode }): JSX.Element {
    return (
        <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-sm rounded-xl bg-surface border border-edge p-6 text-center space-y-4">
                {children}
            </div>
        </div>
    );
}

function StatusChip({ isOpen }: { isOpen: boolean }): JSX.Element {
    const tone = isOpen ? 'bg-success/10 text-success border-success/30' : 'bg-panel text-muted border-edge';
    return (
        <span data-testid="poll-share-status" className={`inline-flex px-2.5 py-1 text-xs font-medium rounded-full border ${tone}`}>
            {isOpen ? 'Open' : 'Closed'}
        </span>
    );
}

export function PollSharePreviewCard({ preview, onSignIn }: {
    preview: PollSharePreviewDto; onSignIn: () => void;
}): JSX.Element {
    return (
        <ShareCardShell>
            {preview.gameCoverUrl && (
                <img src={preview.gameCoverUrl} alt="" className="mx-auto h-32 rounded-lg object-cover" />
            )}
            <h1 className="text-xl font-bold text-foreground">{preview.gameName}</h1>
            <p className="text-sm text-secondary">
                {preview.creatorDisplayName} invited you to vote on a time to play
            </p>
            <StatusChip isOpen={preview.isOpen} />
            <Button variant="primary" size="lg" fullWidth onClick={onSignIn}>Sign in with Discord</Button>
        </ShareCardShell>
    );
}

export function PollShareMessageCard({ message }: { message: string }): JSX.Element {
    return (
        <ShareCardShell>
            <p className="text-sm text-secondary" role="alert">{message}</p>
        </ShareCardShell>
    );
}

export function PollShareLoadingCard(): JSX.Element {
    return (
        <ShareCardShell>
            <div className="h-32 bg-overlay rounded-lg animate-pulse" aria-hidden="true" />
            <p className="text-sm text-muted">Opening poll…</p>
        </ShareCardShell>
    );
}
