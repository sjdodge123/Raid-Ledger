/**
 * ROK-1175 — core's Forum tab (every hub kind). Reads `?thread=<id>`
 * (`forum-link.ts`): no id = the thread list, an id = the thread view.
 * Lazy-loaded by the hub shell, so none of this rides in the `hub-page` chunk.
 *
 * "New thread" swaps the list for the composer; posting opens the new thread.
 * `&edit=1` (a list row's Edit) opens the thread with its root in the editor.
 */
import { useState, type JSX } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { GuildKind } from '@raid-ledger/contract';
import { useAuth } from '../../../hooks/use-auth';
import { ForumThreadComposer } from './forum-composer';
import { ForumThreadList } from './forum-thread-list';
import { ForumThreadView } from './forum-thread-view';
import { editFromSearch, forumThreadHref, replyIdFromSearch, threadIdFromSearch } from './forum-link';

export interface HubForumTabProps {
    guildId: number;
    /** Members and staff (a staff viewer's ladder role is `leader`) start threads and reply (Q1); visitors never see the tab. */
    canWrite: boolean;
    /** Officers/leaders/staff (`page.viewer.canEdit`, the api's `canModerate`): pin and remove any thread from the list. */
    canModerate?: boolean | undefined;
    kind?: GuildKind | undefined;
}

/** The Forum tab panel (see file docstring). */
export function HubForumTab({ guildId, canWrite, canModerate = false, kind }: HubForumTabProps): JSX.Element {
    const { search } = useLocation();
    const { user } = useAuth();
    const navigate = useNavigate();
    const threadId = threadIdFromSearch(search);
    const [composing, setComposing] = useState(false);
    if (threadId !== null) {
        return <ForumThreadView guildId={guildId} threadId={threadId} replyId={replyIdFromSearch(search)} canWrite={canWrite} startEditing={editFromSearch(search)} />;
    }
    if (composing && canWrite) {
        const posted = (id: number): void => { setComposing(false); void navigate(forumThreadHref(id)); };
        return <ForumThreadComposer guildId={guildId} onCancel={() => setComposing(false)} onPosted={(t) => posted(t.id)} />;
    }
    const viewer = { userId: user?.id ?? null, canWrite, canModerate };
    return <ForumThreadList guildId={guildId} kind={kind} viewer={viewer} onNewThread={canWrite ? () => setComposing(true) : undefined} />;
}
