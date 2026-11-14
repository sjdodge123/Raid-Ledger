/**
 * ROK-1175 — core's Forum tab (every hub kind). Reads `?thread=<id>`
 * (`forum-link.ts`): no id = the thread list, an id = the thread view.
 * Lazy-loaded by the hub shell, so none of this rides in the `hub-page` chunk.
 *
 * "New thread" swaps the list for the composer; posting opens the new thread.
 */
import { useState, type JSX } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { GuildKind } from '@raid-ledger/contract';
import { ForumThreadComposer } from './forum-composer';
import { ForumThreadList } from './forum-thread-list';
import { ForumThreadView } from './forum-thread-view';
import { forumThreadHref, replyIdFromSearch, threadIdFromSearch } from './forum-link';

export interface HubForumTabProps {
    guildId: number;
    /** Members and staff (a staff viewer's ladder role is `leader`) start threads and reply (Q1); visitors never see the tab. */
    canWrite: boolean;
    kind?: GuildKind | undefined;
}

/** The Forum tab panel (see file docstring). */
export function HubForumTab({ guildId, canWrite, kind }: HubForumTabProps): JSX.Element {
    const { search } = useLocation();
    const navigate = useNavigate();
    const threadId = threadIdFromSearch(search);
    const [composing, setComposing] = useState(false);
    if (threadId !== null) return <ForumThreadView guildId={guildId} threadId={threadId} replyId={replyIdFromSearch(search)} canWrite={canWrite} />;
    if (composing && canWrite) {
        const posted = (id: number): void => { setComposing(false); void navigate(forumThreadHref(id)); };
        return <ForumThreadComposer guildId={guildId} onCancel={() => setComposing(false)} onPosted={(t) => posted(t.id)} />;
    }
    return <ForumThreadList guildId={guildId} kind={kind} onNewThread={canWrite ? () => setComposing(true) : undefined} />;
}
