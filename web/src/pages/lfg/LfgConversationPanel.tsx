/**
 * ROK-1483 — the LFG group's Discord conversation, mirrored read-only.
 *
 * This component owns the chrome and ONE decision: is there a thread at all.
 * Everything below it is surface-agnostic (`ThreadedChatViewer` takes a thread
 * and a surface reference and nothing else), which is what lets ROK-1484 mount
 * the same viewer on a lineup or a poll page.
 */
import type { JSX } from 'react';
import { ThreadedChatViewer } from '../../components/discord/threaded-chat-viewer';
import { LFG_COPY } from './lfg-copy';

export interface LfgConversationPanelProps {
    /** Numeric game id — the `lfg-group` surface id, stringified on the wire. */
    gameId: number;
    /** The group's live forum thread, or null when it has none. */
    threadId: string | null;
}

/**
 * The conversation panel, or nothing at all.
 *
 * A group with no forum thread renders NO panel rather than an empty shell:
 * the board can be off, the post can have failed, or the group can live on the
 * text surface, and none of those are a conversation the reader can join.
 *
 * @param props.gameId - Game whose group this is.
 * @param props.threadId - Mirrored thread id, or null.
 */
export function LfgConversationPanel({
    gameId,
    threadId,
}: LfgConversationPanelProps): JSX.Element | null {
    if (threadId === null) return null;
    return (
        <section
            data-testid="lfg-conversation-panel"
            className="rounded-xl bg-surface p-4"
        >
            <h2 className="mb-3 text-sm font-semibold text-foreground">
                {LFG_COPY.conversationTitle}
            </h2>
            <ThreadedChatViewer
                threadId={threadId}
                surface={{ kind: 'lfg-group', id: String(gameId) }}
            />
        </section>
    );
}
