/**
 * Subscribe link (ROK-1599, design K6): a private ICS feed URL for calendar
 * apps we can't connect to. No feed → intro + "Get link"; a feed → the
 * read-only link (the `PollShareLink` field pattern), "Open in calendar app"
 * (a real `<a href="webcal://…">`, so the OS hands it to the default calendar
 * app — operator ruling: an anchor, not a scripted button),
 * "Copy link" (the https form, via `copyWithToast`) and "Reset link" behind
 * a destructive confirm. No tentative switch — tentative sign-ups are always
 * in the feed (operator ruling, OPERATOR-2). Failures show inline (§4.8).
 */
import { useState, type JSX } from 'react';
import type { CalendarFeed } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { buttonClass } from '../../ui/button-classes';
import { Input } from '../../ui/input';
import { copyWithToast } from '../../../lib/clipboard';
import { useCreateOrResetFeed } from '../../../hooks/use-calendar-feed';
import { SubscribeLinkResetConfirm } from './SubscribeLinkResetConfirm';
import { FEED_COPY as F, webcalUrl } from './calendar-feed.copy';

function NoFeed({ onGet, pending, failed }: { onGet: () => void; pending: boolean; failed: boolean }): JSX.Element {
    return (
        <div className="space-y-3" data-testid="calendar-feed-empty">
            <p className="text-sm text-secondary">{F.intro}</p>
            <Button onClick={onGet} loading={pending} loadingLabel={F.gettingLink} data-testid="calendar-feed-get">
                {F.getLink}
            </Button>
            {failed && <p role="alert" className="text-sm text-danger">{F.createFailed}</p>}
        </div>
    );
}

function FeedLink({ url, onReset }: { url: string; onReset: () => void }): JSX.Element {
    return (
        <div className="space-y-3" data-testid="calendar-feed-link">
            <p className="text-xs font-medium text-secondary">{F.linkLabel}</p>
            <Input type="text" readOnly value={url} aria-label={F.linkLabel} fieldSize="sm"
                data-testid="calendar-feed-url" onClick={(e) => e.currentTarget.select()} />
            <div className="flex flex-col gap-2 sm:flex-row">
                <a href={webcalUrl(url)} className={buttonClass({})} data-testid="calendar-feed-open">{F.open}</a>
                <Button variant="secondary" data-testid="calendar-feed-copy"
                    onClick={() => { void copyWithToast(url, { success: F.copied }); }}>
                    {F.copy}
                </Button>
            </div>
            <p className="text-xs text-muted">{F.note}</p>
            <Button variant="ghost" size="sm" onClick={onReset} data-testid="calendar-feed-reset">{F.reset}</Button>
        </div>
    );
}

export function SubscribeLinkCard({ feed }: { feed: CalendarFeed | null }): JSX.Element {
    const mutation = useCreateOrResetFeed();
    const [confirming, setConfirming] = useState(false);
    const [resetFailed, setResetFailed] = useState(false);
    if (!feed) return <NoFeed onGet={() => mutation.mutate()} pending={mutation.isPending} failed={mutation.isError} />;
    const openConfirm = (): void => { setResetFailed(false); setConfirming(true); };
    const confirmReset = (): void => {
        setResetFailed(false);
        mutation.mutate(undefined, { onSuccess: () => setConfirming(false), onError: () => setResetFailed(true) });
    };
    return (
        <>
            <FeedLink url={feed.url} onReset={openConfirm} />
            <SubscribeLinkResetConfirm isOpen={confirming} isPending={mutation.isPending} failed={resetFailed}
                onCancel={() => setConfirming(false)} onConfirm={confirmReset} />
        </>
    );
}
