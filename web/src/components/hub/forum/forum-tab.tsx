/**
 * ROK-1175 — core's Forum tab (every hub kind). Reads `?thread=<id>`
 * (`forum-link.ts`): no id = the thread list, an id = the thread view.
 * Lazy-loaded by the hub shell, so none of this rides in the `hub-page` chunk.
 *
 * L5 fills the thread view (`forum-thread-view.tsx`) and the new-thread
 * composer; until then both render a placeholder panel.
 */
import { useState, type JSX } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { GuildKind } from '@raid-ledger/contract';
import { FOCUS_RING } from '../../ui/form-classes';
import { ForumThreadList } from './forum-thread-list';
import { threadIdFromSearch } from './forum-link';

export interface HubForumTabProps {
    guildId: number;
    /** A member may start threads and reply (Q1); staff/visitors read only. */
    canWrite: boolean;
    kind?: GuildKind | undefined;
}

/** Placeholder until L5's thread view / composer land. */
function PendingPanel({ testId, children }: { testId: string; children: string }): JSX.Element {
    return (
        <div data-testid={testId} className="rounded-lg border border-edge bg-surface p-4 text-sm text-muted">
            {/* A router Link (the hash stays `#forum`, so `useHashTab` needs no hashchange); drops `?thread=`. */}
            <Link to={{ search: '', hash: 'forum' }} className={`mb-2 inline-block rounded-sm text-sm font-medium text-success underline-offset-2 hover:underline ${FOCUS_RING}`}>
                ← Back to Forum
            </Link>
            {children}
        </div>
    );
}

/** The Forum tab panel (see file docstring). */
export function HubForumTab({ guildId, canWrite, kind }: HubForumTabProps): JSX.Element {
    const threadId = threadIdFromSearch(useLocation().search);
    const [composing, setComposing] = useState(false);
    if (threadId !== null) return <PendingPanel testId="hub-forum-thread">Loading thread…</PendingPanel>;
    if (composing) return <PendingPanel testId="hub-forum-composer">New thread</PendingPanel>;
    return <ForumThreadList guildId={guildId} kind={kind} onNewThread={canWrite ? () => setComposing(true) : undefined} />;
}
