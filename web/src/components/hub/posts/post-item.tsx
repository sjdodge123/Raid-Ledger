/**
 * ROK-1868 W3 — one Posts-tab item: byline + meta, "In Discord" when relayed,
 * the markdown body clamped at 6 lines with "Show more / Show less" (only when
 * it overflows), "Copy link" for everyone, Edit (inline) + Delete for editors.
 */
import { useEffect, useId, useRef, useState, type JSX, type RefObject } from 'react';
import { LinkIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import type { HubPost } from '@raid-ledger/contract';
import { copyWithToast } from '../../../lib/clipboard';
import { Button } from '../../ui/button';
import { MarkdownBlock } from '../../ui/markdown-block';
import { Pill } from '../hub-bits';
import { DeletePostConfirm } from './delete-post-confirm';
import { postDeepLink } from './hub-post.helpers';
import { PostByline } from './post-byline';
import { PostEditor } from './post-editor';
import { useOverflow } from './use-overflow';

export interface PostItemProps {
    guildId: number;
    post: HubPost;
    canEdit: boolean;
    /** The `?post=<id>` target: opens expanded, ringed, and scrolls into view once. */
    highlighted?: boolean;
}

function RelayBadge({ post }: { post: HubPost }): JSX.Element | null {
    if (!post.relay) return null;
    return (
        <div className="flex flex-wrap items-center gap-2">
            <Pill>In Discord</Pill>
            {post.relay.messageUrl && (
                <a href={post.relay.messageUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs font-medium text-success hover:underline">View in Discord</a>
            )}
        </div>
    );
}

/** The 6-line body clamp, `max-h-[7.5rem]`, in rem. */
const CLAMP_REM = 7.5;

interface BodyProps { post: HubPost; expanded: boolean; bodyId: string; onToggle: () => void; actions: JSX.Element }

function PostBody({ post, expanded, bodyId, onToggle, actions }: BodyProps): JSX.Element {
    const clampRef = useRef<HTMLDivElement>(null);
    // Measured against the 6-line clamp (7.5rem) so a short deep-linked post, which opens
    // expanded, offers no toggle (review MAJOR).
    const overflowing = useOverflow(clampRef, [post.body, expanded], CLAMP_REM);
    return (
        <>
            <div ref={clampRef} id={bodyId} data-testid="hub-post-item-clamp" className={expanded ? '' : 'max-h-[7.5rem] overflow-hidden'}>
                <MarkdownBlock text={post.body} className="text-sm text-secondary" testId="hub-post-item-text" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                {overflowing && (
                    <Button variant="ghost" size="sm" aria-expanded={expanded} aria-controls={bodyId} onClick={onToggle}>
                        {expanded ? 'Show less' : 'Show more'}
                    </Button>
                )}
                {actions}
            </div>
        </>
    );
}

function ItemActions({ link, canEdit, onEdit, onDelete }: { link: string; canEdit: boolean; onEdit: () => void; onDelete: () => void }): JSX.Element {
    return (
        <>
            <Button variant="ghost" size="sm" onClick={() => { void copyWithToast(link); }}>
                <LinkIcon className="h-4 w-4" aria-hidden="true" /> Copy link
            </Button>
            {canEdit && <Button variant="ghost" size="sm" onClick={onEdit}><PencilSquareIcon className="h-4 w-4" aria-hidden="true" /> Edit</Button>}
            {canEdit && <Button variant="ghost" size="sm" onClick={onDelete}><TrashIcon className="h-4 w-4" aria-hidden="true" /> Delete</Button>}
        </>
    );
}

function useScrollOnce(highlighted: boolean): RefObject<HTMLElement | null> {
    const ref = useRef<HTMLElement>(null);
    useEffect(() => {
        if (highlighted) ref.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }, [highlighted]);
    return ref;
}

/** A feed item; `highlighted` marks the deep-linked post. */
export function PostItem({ guildId, post, canEdit, highlighted = false }: PostItemProps): JSX.Element {
    const [expanded, setExpanded] = useState(highlighted);
    const [mode, setMode] = useState<'read' | 'edit' | 'delete'>('read');
    const bodyId = `hub-post-body-${useId()}`;
    const ref = useScrollOnce(highlighted);
    const ring = highlighted ? 'border-success ring-1 ring-success' : 'border-edge';
    const actions = <ItemActions link={postDeepLink(guildId, post.id)} canEdit={canEdit} onEdit={() => setMode('edit')} onDelete={() => setMode('delete')} />;
    return (
        <article ref={ref} id={`post-${post.id}`} data-testid="hub-post-item" aria-current={highlighted ? 'true' : undefined}
            className={`scroll-mt-4 rounded-lg border bg-surface p-4 ${ring}`}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <PostByline post={post} />
                <RelayBadge post={post} />
            </div>
            {canEdit && mode === 'edit'
                ? <PostEditor guildId={guildId} post={post} onDone={() => setMode('read')} />
                : <PostBody post={post} expanded={expanded} bodyId={bodyId} onToggle={() => setExpanded((v) => !v)} actions={actions} />}
            {canEdit && <DeletePostConfirm guildId={guildId} post={post} isOpen={mode === 'delete'} onClose={() => setMode('read')} />}
        </article>
    );
}
