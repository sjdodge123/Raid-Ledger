/**
 * ROK-1868 wireframe — the post pieces (DEV-ONLY, static, tokens only):
 * byline, composer (Discord switch on / disabled), the Overview latest-post
 * card, one feed item (collapsed, expanded, editing).
 */
import { useState, type JSX, type ReactNode } from 'react';
import { PencilSquareIcon, TrashIcon, LinkIcon } from '@heroicons/react/24/outline';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Textarea } from '../../components/ui/textarea';
import { Switch } from '../../components/ui/switch';
import { Card, Pill } from '../../components/hub/hub-bits';
import { JumpLink } from '../../components/hub/card-bits';
import { AvatarWithFallback } from '../../components/shared/AvatarWithFallback';
import { MOCK_GUILD, deepLink, type MockPost } from './hub-posts-mock';

export function Byline({ post }: { post: MockPost }): JSX.Element {
    return (
        <div className="flex items-center gap-2">
            <AvatarWithFallback username={post.author.name} avatarUrl={null} sizeClassName="h-8 w-8" alt="" />
            <p className="text-sm">
                <span className="font-semibold text-foreground">{post.author.name}</span>
                <span className="block text-xs text-dim">
                    Posted {post.posted}{post.edited ? ` · Edited ${post.edited.at} by ${post.edited.by.name}` : ''}
                </span>
            </p>
        </div>
    );
}

export type ChannelState = 'ok' | 'unset';

const HINT: Record<ChannelState, string> = {
    ok: `Posts to #${MOCK_GUILD.channel}. Edits stay on Raid Ledger.`,
    unset: 'Link a Discord channel in Guild settings to post there.',
};

/** W1 — inline composer. `channel: 'unset'` is the disabled-with-hint state (ruling R2). */
export function ComposerMock({ channel, relayDefault = true }: { channel: ChannelState; relayDefault?: boolean }): JSX.Element {
    const [relay, setRelay] = useState(channel === 'ok' && relayDefault);
    const [draft, setDraft] = useState(channel === 'ok' ? 'Reminder: consumables are on the guild bank tab 3.' : '');
    const hintId = `wf-relay-hint-${channel}`;
    return (
        <div className="flex flex-col gap-3" data-testid={`wf-composer-${channel}`}>
            <Field label="New post" hint="Members see this at the top of the guild page.">
                <Textarea rows={4} value={draft} maxLength={4000} showCount onChange={(e) => setDraft(e.target.value)} />
            </Field>
            <div className="rounded-lg border border-edge bg-panel p-3">
                <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-foreground">Also post to Discord</span>
                    <Switch checked={relay} onChange={setRelay} label="Also post to Discord" disabled={channel !== 'ok'} aria-describedby={hintId} />
                </div>
                <p id={hintId} className={`mt-1 text-xs ${channel === 'ok' ? 'text-muted' : 'text-warning'}`}>{HINT[channel]}</p>
            </div>
            <div className="flex justify-end gap-2">
                <Button variant="secondary">Cancel</Button>
                <Button disabled={draft.trim() === ''}>Post</Button>
            </div>
        </div>
    );
}

function CardHead({ action }: { action?: ReactNode }): JSX.Element {
    return (
        <div className="mb-3 flex items-start justify-between gap-3">
            <Pill tone="success">From the guild master</Pill>
            {action}
        </div>
    );
}

/** W2 — the Overview card: newest post, editor actions, "Previous posts". */
export function LatestPostCardMock({ post, editor, composing = false }: { post: MockPost; editor: boolean; composing?: boolean }): JSX.Element {
    const action = editor && !composing ? (
        <div className="flex gap-2">
            <Button variant="secondary" size="sm"><PencilSquareIcon className="h-4 w-4" aria-hidden="true" /> Edit</Button>
            <Button size="sm">New post</Button>
        </div>
    ) : undefined;
    return (
        <Card className="border-l-4 border-l-success">
            <CardHead action={action} />
            {composing && <div className="mb-4 border-b border-edge pb-4"><ComposerMock channel="ok" /></div>}
            <div className="mb-2 line-clamp-[12] whitespace-pre-line break-words text-sm text-secondary">{post.body}</div>
            <a href={deepLink(post.id)} className="mb-4 inline-block text-sm font-medium text-success hover:underline">Read the full post</a>
            <div className="flex flex-wrap items-end justify-between gap-3">
                <Byline post={post} />
                <JumpLink testId="wf-previous-posts" href="#posts">Previous posts</JumpLink>
            </div>
        </Card>
    );
}

/** W3 — one feed item. `mode` drives collapsed / expanded / editing. */
export function PostItemMock({ post, mode, editor }: { post: MockPost; mode: 'collapsed' | 'expanded' | 'editing'; editor: boolean }): JSX.Element {
    const [draft, setDraft] = useState(post.body);
    return (
        <article className={`rounded-lg border bg-surface p-4 ${mode === 'expanded' ? 'border-success ring-1 ring-success' : 'border-edge'}`}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <Byline post={post} />
                {post.relayedTo && <Pill>In Discord · #{post.relayedTo}</Pill>}
            </div>
            {mode === 'editing' ? (
                <div className="flex flex-col gap-3">
                    <Textarea rows={6} value={draft} maxLength={4000} showCount onChange={(e) => setDraft(e.target.value)} aria-label="Edit post" />
                    {post.relayedTo && <p className="text-xs text-muted">Edits update this page only — the Discord post isn’t changed.</p>}
                    <div className="flex justify-end gap-2"><Button variant="secondary">Cancel</Button><Button>Save</Button></div>
                </div>
            ) : (
                <>
                    <div className={`whitespace-pre-line break-words text-sm text-secondary ${mode === 'collapsed' ? 'line-clamp-6' : ''}`}>{post.body}</div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button variant="ghost" size="sm" aria-expanded={mode === 'expanded'}>{mode === 'expanded' ? 'Show less' : 'Show more'}</Button>
                        <Button variant="ghost" size="sm"><LinkIcon className="h-4 w-4" aria-hidden="true" /> Copy link</Button>
                        {editor && <Button variant="ghost" size="sm"><PencilSquareIcon className="h-4 w-4" aria-hidden="true" /> Edit</Button>}
                        {editor && <Button variant="ghost" size="sm"><TrashIcon className="h-4 w-4" aria-hidden="true" /> Delete</Button>}
                    </div>
                </>
            )}
        </article>
    );
}
