/**
 * ROK-1175 — the Forum list view: toolbar ("New thread" `Button` ≥768px, the
 * phone `FAB` below), the pinned group (page 1 only), the activity feed,
 * "Load older threads" and the Q2 empty state "Start the first thread".
 */
import type { JSX } from 'react';
import type { GuildKind, HubForumThreadSummary } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { FAB } from '../../ui/fab';
import { QuietEmpty } from '../card-bits';
import { SectionTitle } from '../hub-bits';
import { hubCopy } from '../hub-copy';
import { ForumThreadRow } from './forum-thread-row';
import { useForumThreads } from './use-hub-forum';

export interface ForumThreadListProps {
    guildId: number;
    kind?: GuildKind | undefined;
    /** Opens the new-thread composer; omitted = the viewer cannot write (no button, no FAB). */
    onNewThread?: (() => void) | undefined;
}

function ListSkeleton(): JSX.Element {
    return (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading threads" data-testid="forum-loading">
            <div className="h-20 animate-pulse rounded-lg border border-edge bg-panel" />
            <div className="h-20 animate-pulse rounded-lg border border-edge bg-panel" />
        </div>
    );
}

function Group({ title, threads }: { title: string; threads: HubForumThreadSummary[] }): JSX.Element | null {
    if (threads.length === 0) return null;
    return (
        <div className="mb-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
            <ul className="flex flex-col gap-2">{threads.map((t) => <ForumThreadRow key={t.id} thread={t} />)}</ul>
        </div>
    );
}

/** "Load older threads", or an inline retry after a next-page error. */
function OlderThreads({ feed }: { feed: ReturnType<typeof useForumThreads> }): JSX.Element | null {
    if (!feed.hasNextPage) return null;
    const failed = feed.isFetchNextPageError;
    return (
        <div className="mt-2 flex flex-col items-center gap-2">
            {failed && <p role="alert" className="text-sm text-danger">Couldn’t load older threads.</p>}
            <Button variant="secondary" loading={feed.isFetchingNextPage} onClick={() => { void feed.fetchNextPage(); }}>
                {failed ? 'Try again' : 'Load older threads'}
            </Button>
        </div>
    );
}

function ListBody({ feed }: { feed: ReturnType<typeof useForumThreads> }): JSX.Element | null {
    if (feed.isPending) return <ListSkeleton />;
    if (feed.data === undefined) return <p role="alert" className="text-sm text-danger">Couldn’t load the forum. Try again later.</p>;
    const pinned = feed.data.pages[0]?.pinned ?? [];
    const threads = feed.data.pages.flatMap((p) => p.threads);
    if (pinned.length + threads.length === 0) return <QuietEmpty testId="forum-empty">Start the first thread</QuietEmpty>;
    return (
        <>
            <Group title="Pinned" threads={pinned} />
            <Group title={pinned.length > 0 ? 'Latest' : 'Threads'} threads={threads} />
            <OlderThreads feed={feed} />
        </>
    );
}

/** The Forum tab's list view (see file docstring). */
export function ForumThreadList({ guildId, kind, onNewThread }: ForumThreadListProps): JSX.Element {
    const copy = hubCopy(kind);
    const feed = useForumThreads(guildId);
    const action = onNewThread
        ? <span className="hidden md:inline-flex"><Button size="sm" onClick={onNewThread} data-testid="forum-new-thread">New thread</Button></span>
        : undefined;
    return (
        <section aria-labelledby="hub-forum-title" data-testid="hub-forum-list">
            <SectionTitle title={copy.forumTab} headingId="hub-forum-title" blurb={copy.forumBlurb} action={action} />
            <ListBody feed={feed} />
            {onNewThread && <FAB onClick={onNewThread} label="New thread" />}
        </section>
    );
}
