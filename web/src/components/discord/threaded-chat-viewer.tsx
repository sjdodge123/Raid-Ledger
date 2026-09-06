/**
 * ROK-1483 — the read-only mirror of one Discord thread.
 *
 * The viewer owns its own data (AC6): it takes a thread and the surface that
 * thread hangs off, and calls the polling hook itself. It never accepts
 * `messages`, `isLoading`, `onLoadMore` or a render prop — that two-prop
 * contract is what lets ROK-1484 mount the same component on a lineup or a
 * poll page without touching this file.
 *
 * It is also deliberately vocabulary-free: every string here is neutral
 * ("Conversation", not "LFG board"), because the surface that owns the panel
 * chrome owns the surface-specific wording.
 */
import { useState, type JSX } from 'react';
import type { ThreadMessageDto, ThreadSurfaceRef } from '@raid-ledger/contract';
import { useThreadMessages } from '../../hooks/use-thread-messages';
import { ThreadMessageRow } from './ThreadMessageRow';

export interface ThreadedChatViewerProps {
    /** Discord thread id the app has already mirrored into Postgres. */
    threadId: string;
    /** The `(kind, id)` surface this thread belongs to, sent as a claim. */
    surface: ThreadSurfaceRef;
}

type Expect<T extends true> = T;
type Equal<A, B> =
    (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2
        ? true
        : false;

/**
 * AC6 — the props are exactly two, enforced at compile time.
 *
 * This pin lives in the COMPONENT file, not in the spec file the story text
 * names, because `web/tsconfig.app.json` excludes `src/**\/*.test.tsx`: a pin
 * placed in the spec is never typechecked by `tsc -b` and would be decorative.
 * Adding a third prop breaks `npm run build -w web`.
 */
export type ThreadedChatViewerPropsPin = Expect<
    Equal<keyof ThreadedChatViewerProps, 'threadId' | 'surface'>
>;

const VIEWER_COPY = {
    title: 'Conversation',
    empty: 'No replies yet — the conversation happens in Discord.',
    openInDiscord: 'Open in Discord ↗',
    loading: 'Loading…',
    loadOlder: 'Load older messages',
    archived: '(archived)',
} as const;

/**
 * D12 — a thread Discord no longer has still renders its mirrored history; only
 * the convenience link degrades, to inert text rather than a dead anchor.
 */
function OpenInDiscord({ threadUrl }: { threadUrl: string | null }): JSX.Element {
    if (threadUrl === null) {
        return (
            <span
                data-testid="thread-open-in-discord"
                className="text-xs text-muted"
            >
                {VIEWER_COPY.openInDiscord}
            </span>
        );
    }
    return (
        <a
            data-testid="thread-open-in-discord"
            href={threadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary underline underline-offset-2"
        >
            {VIEWER_COPY.openInDiscord}
        </a>
    );
}

/**
 * D9 — the starter post is a static header rather than a mirrored row: it is an
 * embed with no content, and the owning bot rewrites it on every roster change.
 * Archive is not an end state (D12), so it is a marker, not an empty panel.
 */
function ThreadStarterHeader({
    threadUrl,
    archived,
}: {
    threadUrl: string | null;
    archived: boolean;
}): JSX.Element {
    return (
        <header className="flex items-center justify-end gap-2">
            {archived && (
                <span
                    data-testid="thread-archived"
                    className="mr-auto text-xs text-muted"
                >
                    {VIEWER_COPY.archived}
                </span>
            )}
            <OpenInDiscord threadUrl={threadUrl} />
        </header>
    );
}

/** The backwards pager: `before` is the OLDEST message currently on screen. */
function LoadOlderButton({ onClick }: { onClick: () => void }): JSX.Element {
    return (
        <button
            type="button"
            data-testid="thread-load-older"
            onClick={onClick}
            className="w-full rounded-lg bg-overlay px-3 py-1.5 text-xs text-muted"
        >
            {VIEWER_COPY.loadOlder}
        </button>
    );
}

/** Loading, empty and the message list — the three states of one page. */
function ThreadBody({
    messages,
    isLoading,
}: {
    messages: ThreadMessageDto[];
    isLoading: boolean;
}): JSX.Element {
    return (
        <>
            {isLoading && (
                <p data-testid="thread-loading" className="text-sm text-muted">
                    {VIEWER_COPY.loading}
                </p>
            )}
            {!isLoading && messages.length === 0 && (
                <p data-testid="thread-empty" className="text-sm text-muted">
                    {VIEWER_COPY.empty}
                </p>
            )}
            <ul className="space-y-2">
                {messages.map((message) => (
                    <ThreadMessageRow key={message.messageId} message={message} />
                ))}
            </ul>
        </>
    );
}

/**
 * Renders one mirrored thread: the static starter header, the messages oldest
 * first, and a backwards pager.
 *
 * Paging replaces the visible page rather than appending to it — `before` is
 * part of the query key, so each page is cached and polled on its own. An
 * appending viewer would have to reconcile edits and deletes across pages,
 * which is the exact thing D11 chose the full-page refetch to avoid.
 *
 * @param props.threadId - Mirrored Discord thread to render.
 * @param props.surface - Surface claim sent with every request.
 */
export function ThreadedChatViewer({
    threadId,
    surface,
}: ThreadedChatViewerProps): JSX.Element {
    const [before, setBefore] = useState<string | undefined>(undefined);
    const { data, isLoading } = useThreadMessages(threadId, surface, before);
    const messages = data?.messages ?? [];
    return (
        <section
            data-testid="threaded-chat-viewer"
            aria-label={VIEWER_COPY.title}
            className="space-y-2"
        >
            <ThreadStarterHeader
                threadUrl={data?.threadUrl ?? null}
                archived={data?.archived ?? false}
            />
            {data?.hasMore === true && (
                <LoadOlderButton
                    onClick={() => setBefore(messages[0]?.messageId)}
                />
            )}
            <ThreadBody messages={messages} isLoading={isLoading} />
        </section>
    );
}
