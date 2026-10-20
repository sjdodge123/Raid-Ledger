/**
 * ROK-1868 W2/W2b — the Overview's newest leader post (replaces the ROK-1786
 * GM post card in the same cell). Body is markdown, height-clamped at 12 lines
 * (D6) with "Read the full post"; editors edit inline or open the composer
 * above it (D9, no overlay). A 403 (members-first visitor) renders nothing.
 */
import { useRef, useState, type JSX } from 'react';
import { PencilSquareIcon } from '@heroicons/react/24/outline';
import type { GuildKind, HubPost } from '@raid-ledger/contract';
import { httpStatusOf } from '../../../lib/api/api-error';
import { Button } from '../../ui/button';
import { MarkdownBlock } from '../../ui/markdown-block';
import { JumpLink } from '../card-bits';
import { hubCopy, type HubCopy } from '../hub-copy';
import { Card, Pill } from '../hub-bits';
import { useGuildProfile } from '../api/use-guild-content';
import { relayOutcomeNotice, type PostNotice } from './hub-post.helpers';
import { PostByline } from './post-byline';
import { PostComposer, type PostComposerProps } from './post-composer';
import { PostEditor } from './post-editor';
import { useHasPreviousPosts } from './use-hub-posts';
import { useOverflow } from './use-overflow';

type Mode = 'read' | 'compose' | 'edit';

function PostSkeleton(): JSX.Element {
    return (
        <div className="animate-pulse space-y-2" data-testid="guild-gm-post-loading" aria-busy="true" aria-label="Loading the guild post">
            <div className="h-4 w-3/4 rounded bg-panel" />
            <div className="h-4 w-1/2 rounded bg-panel" />
        </div>
    );
}

function LatestPost({ post, guildId, previous }: { post: HubPost; guildId: number; previous: string }): JSX.Element {
    const bodyRef = useRef<HTMLDivElement>(null);
    const clamped = useOverflow(bodyRef, [post.body]);
    const hasPrevious = useHasPreviousPosts(guildId, true);
    return (
        <>
            <div ref={bodyRef} className="mb-2 max-h-[15rem] overflow-hidden">
                <MarkdownBlock text={post.body} className="text-sm text-secondary" testId="guild-gm-post-body" />
            </div>
            {clamped && <a href={`?post=${post.id}#posts`} className="mb-2 inline-block text-sm font-medium text-success hover:underline">Read the full post</a>}
            <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                <PostByline post={post} testId="guild-gm-post-byline" />
                {hasPrevious && <JumpLink testId="hub-posts-previous" href="#posts">{previous}</JumpLink>}
            </div>
        </>
    );
}

function EmptyPost({ canEdit, copy, onCompose }: { canEdit: boolean; copy: HubCopy; onCompose: () => void }): JSX.Element {
    if (!canEdit) return <p className="text-sm text-muted" data-testid="guild-gm-post-empty">{copy.leaderPostEmpty}</p>;
    return (
        <div className="flex flex-col items-start gap-2" data-testid="guild-gm-post-prompt">
            <p className="text-sm text-muted">Share news, plans or a welcome with everyone here.</p>
            <Button variant="secondary" size="sm" onClick={onCompose}>Add a post</Button>
        </div>
    );
}

function Actions({ hasPost, onEdit, onCompose }: { hasPost: boolean; onEdit: () => void; onCompose: () => void }): JSX.Element {
    return (
        <div className="flex gap-2">
            {hasPost && (
                <Button variant="secondary" size="sm" aria-label="Edit the latest post" onClick={onEdit} data-testid="hub-post-edit">
                    <PencilSquareIcon className="h-4 w-4" aria-hidden="true" /> Edit
                </Button>
            )}
            {hasPost && <Button size="sm" onClick={onCompose} data-testid="hub-post-new">New post</Button>}
        </div>
    );
}

function Notice({ notice }: { notice: PostNotice | null }): JSX.Element {
    const tone = notice?.tone === 'warning' ? 'text-warning' : 'text-success';
    return <p role="status" className={`text-sm empty:hidden ${tone}`} data-testid="hub-post-relay-notice">{notice?.text}</p>;
}

interface CardBodyProps {
    state: 'pending' | 'error' | 'ready'; post: HubPost | null; guildId: number; canEdit: boolean;
    mode: Mode; copy: HubCopy; onCompose: () => void; onDone: () => void;
}

function CardBody({ state, post, guildId, canEdit, mode, copy, onCompose, onDone }: CardBodyProps): JSX.Element | null {
    if (state === 'pending') return <PostSkeleton />;
    if (state === 'error') return <p role="alert" className="text-sm text-danger" data-testid="guild-gm-post-error">Couldn’t load the guild post. Try again later.</p>;
    if (canEdit && mode === 'edit' && post) return <PostEditor guildId={guildId} post={post} onDone={onDone} />;
    if (post) return <LatestPost post={post} guildId={guildId} previous={copy.previousPosts} />;
    return mode === 'compose' ? null : <EmptyPost canEdit={canEdit} copy={copy} onCompose={onCompose} />;
}

/** W2b — the composer opens inline above the current post. */
function ComposeSlot(props: PostComposerProps): JSX.Element {
    return <div className="mb-4 border-b border-edge pb-4"><PostComposer {...props} /></div>;
}

export interface LatestPostCardProps { guildId: number; canEdit: boolean; isLeader: boolean; kind?: GuildKind | undefined }

/** The newest post (or the empty state) with editor actions and the relay notice. */
export function LatestPostCard({ guildId, canEdit, isLeader, kind }: LatestPostCardProps): JSX.Element | null {
    const [mode, setMode] = useState<Mode>('read');
    const [notice, setNotice] = useState<PostNotice | null>(null);
    const profile = useGuildProfile(guildId);
    const copy = hubCopy(kind);
    if (httpStatusOf(profile.error) === 403) return null;
    const post = profile.data?.latestPost ?? null;
    const ready = !profile.isPending && !profile.isError;
    const compose = (): void => { setNotice(null); setMode('compose'); };
    return (
        <section id="gm-post" aria-labelledby="gm-post-title" className="scroll-mt-4 md:col-span-2" data-testid="guild-gm-post">
            <Card className="h-full border-l-4 border-l-success">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <Pill tone="success">{copy.leaderPostPill}</Pill>
                        <h2 id="gm-post-title" className="sr-only">{copy.leaderPostHeading}</h2>
                    </div>
                    {canEdit && ready && mode === 'read' && <Actions hasPost={!!post} onEdit={() => setMode('edit')} onCompose={compose} />}
                </div>
                <Notice notice={notice} />
                {canEdit && mode === 'compose' && (
                    <ComposeSlot guildId={guildId} kind={kind} isLeader={isLeader} onCancel={() => setMode('read')}
                        onPosted={(res, channel) => { setNotice(relayOutcomeNotice(res.relayOutcome, channel)); setMode('read'); }} />
                )}
                <CardBody state={profile.isPending ? 'pending' : profile.isError ? 'error' : 'ready'} post={post} guildId={guildId}
                    canEdit={canEdit} mode={mode} copy={copy} onCompose={compose} onDone={() => setMode('read')} />
            </Card>
        </section>
    );
}
