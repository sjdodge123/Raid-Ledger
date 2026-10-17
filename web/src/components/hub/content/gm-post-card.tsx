/**
 * ROK-1786 — the guild master's post (prototype `GmPost.tsx`), top of the
 * Overview grid. Everyone reads it; `canEdit` viewers edit it inline.
 */
import { useState, type JSX } from 'react';
import { PencilSquareIcon } from '@heroicons/react/24/outline';
import { GUILD_GM_POST_MAX, type GuildGmPost } from '@raid-ledger/contract';
import { AvatarWithFallback } from '../../shared/AvatarWithFallback';
import { Button } from '../../ui/button';
import { Field } from '../../ui/field';
import { Textarea } from '../../ui/textarea';
import { Card, Pill } from '../hub-bits';
import { updatedLabel } from './guild-content.helpers';
import { useGuildProfile, useUpdateGuildProfile } from '../api/use-guild-content';

function PostByline({ post }: { post: GuildGmPost }): JSX.Element {
    const author = post.updatedBy ?? 'A former member';
    return (
        <div className="flex items-center gap-2" data-testid="guild-gm-post-byline">
            <AvatarWithFallback username={author} avatarUrl={null} sizeClassName="h-8 w-8" alt="" />
            <p className="text-sm">
                <span className="font-semibold text-foreground">{author}</span>
                <span className="block text-xs text-dim">Updated {updatedLabel(post.updatedAt)}</span>
            </p>
        </div>
    );
}

function PostEditor({ guildId, initial, onDone }: { guildId: number; initial: string; onDone: () => void }): JSX.Element {
    const [draft, setDraft] = useState(initial);
    const save = useUpdateGuildProfile(guildId);
    const submit = (): void => save.mutate({ gmPost: draft.trim() || null }, { onSuccess: onDone });
    return (
        <div className="flex flex-col gap-3" data-testid="guild-gm-post-editor">
            <Field label="Guild post" hint="Members see this at the top of the guild page." error={save.error ? 'Couldn’t save the post. Try again.' : undefined}>
                <Textarea rows={6} value={draft} maxLength={GUILD_GM_POST_MAX} showCount onChange={(e) => setDraft(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={onDone}>Cancel</Button>
                <Button onClick={submit} loading={save.isPending} data-testid="guild-gm-post-save">Save</Button>
            </div>
        </div>
    );
}

function PostSkeleton(): JSX.Element {
    return (
        <div className="animate-pulse space-y-2" data-testid="guild-gm-post-loading" aria-busy="true" aria-label="Loading the guild post">
            <div className="h-4 w-3/4 rounded bg-panel" />
            <div className="h-4 w-1/2 rounded bg-panel" />
        </div>
    );
}

function PostError(): JSX.Element {
    return <p role="alert" className="text-sm text-danger" data-testid="guild-gm-post-error">Couldn’t load the guild post. Try again later.</p>;
}

function PostBody({ post, canEdit, onEdit }: { post: GuildGmPost | null; canEdit: boolean; onEdit: () => void }): JSX.Element {
    if (!post) {
        if (!canEdit) return <p className="text-sm text-muted" data-testid="guild-gm-post-empty">No post from the guild master yet.</p>;
        return (
            <div className="flex flex-col items-start gap-2" data-testid="guild-gm-post-prompt">
                <p className="text-sm text-muted">Share news, raid plans or a welcome with everyone in the guild.</p>
                <Button variant="secondary" size="sm" onClick={onEdit}>Add a post</Button>
            </div>
        );
    }
    return (
        <>
            <div className="mb-4 whitespace-pre-line break-words text-sm text-secondary" data-testid="guild-gm-post-body">{post.body}</div>
            <PostByline post={post} />
        </>
    );
}

export function GmPostCard({ guildId, canEdit }: { guildId: number; canEdit: boolean }): JSX.Element {
    const [editing, setEditing] = useState(false);
    const profile = useGuildProfile(guildId);
    const post = profile.data?.gmPost ?? null;
    const ready = !profile.isPending && !profile.isError;
    return (
        <section id="gm-post" aria-labelledby="gm-post-title" className="scroll-mt-4 md:col-span-2" data-testid="guild-gm-post">
            <Card className="h-full border-l-4 border-l-success">
                <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <Pill tone="success">From the guild master</Pill>
                        <h2 id="gm-post-title" className="sr-only">Message from the guild master</h2>
                    </div>
                    {canEdit && ready && post && !editing && (
                        <Button variant="secondary" size="sm" aria-label="Edit the guild post" onClick={() => setEditing(true)}>
                            <PencilSquareIcon className="h-4 w-4" aria-hidden="true" /> Edit
                        </Button>
                    )}
                </div>
                {profile.isPending ? <PostSkeleton />
                    : profile.isError ? <PostError />
                    : editing && canEdit
                        ? <PostEditor guildId={guildId} initial={post?.body ?? ''} onDone={() => setEditing(false)} />
                        : <PostBody post={post} canEdit={canEdit} onEdit={() => setEditing(true)} />}
            </Card>
        </section>
    );
}
