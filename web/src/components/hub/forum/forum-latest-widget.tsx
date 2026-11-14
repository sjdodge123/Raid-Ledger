/**
 * ROK-1175 — the Overview "Latest threads" card (§4.27): up to
 * `HUB_FORUM_LATEST_LIMIT` rows (title, Pinned pill, "N replies · 2 h ago"),
 * each opening its thread on the Forum tab. Default export for `React.lazy`.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { HUB_FORUM_LATEST_LIMIT, type HubForumThreadSummary } from '@raid-ledger/contract';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import { FOCUS_RING } from '../../ui/form-classes';
import { syncedAgo } from '../../../lib/synced-ago';
import { QuietEmpty } from '../card-bits';
import { Pill } from '../hub-bits';
import { forumThreadHref } from './forum-link';
import { replyCountLabel } from './forum-thread.helpers';
import { useLatestThreads } from './use-hub-forum';

export const FORUM_LATEST_EMPTY = 'No threads yet. Start one in the Forum.';

function LatestRow({ thread }: { thread: HubForumThreadSummary }): JSX.Element {
    return (
        <li data-testid="forum-latest-row">
            <Link to={forumThreadHref(thread.id)} className={`block rounded-md px-1 py-1.5 hover:bg-panel ${FOCUS_RING}`}>
                <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{thread.title}</span>
                    {thread.pinnedAt !== null && <Pill tone="success">Pinned</Pill>}
                </span>
                <span className="block text-xs text-muted">{replyCountLabel(thread.replyCount)} · {syncedAgo(thread.lastActivityAt, Date.now())}</span>
            </Link>
        </li>
    );
}

/** The card body (see file docstring); visitors never fetch. */
export default function ForumLatestWidget({ page }: HubWidgetCtx): JSX.Element | null {
    const reader = page.viewer.role !== 'visitor';
    const { data, isPending } = useLatestThreads(page.guild.id, reader);
    if (!reader) return null;
    if (isPending) return <div className="h-24 animate-pulse rounded-md bg-panel" aria-busy="true" aria-label="Loading threads" />;
    const threads = (data?.threads ?? []).filter((t) => t.deleted === null).slice(0, HUB_FORUM_LATEST_LIMIT);
    if (threads.length === 0) return <QuietEmpty testId="forum-latest-empty">{FORUM_LATEST_EMPTY}</QuietEmpty>;
    return <ul className="flex flex-col divide-y divide-edge" data-testid="forum-latest">{threads.map((t) => <LatestRow key={t.id} thread={t} />)}</ul>;
}
