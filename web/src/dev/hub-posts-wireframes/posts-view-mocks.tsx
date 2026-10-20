/**
 * ROK-1868 wireframe — the Posts tab, the single-post deep link, the delete
 * confirm and the relayed Discord message (DEV-ONLY, static, tokens only).
 * The Discord frame reuses the ROK-1553 Discord chrome, which deliberately
 * paints Discord's own colours (see `scheduling-wireframes/discord-chrome.tsx`).
 */
import type { JSX } from 'react';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { Button } from '../../components/ui/button';
import { SectionTitle } from '../../components/hub/hub-bits';
import { QuietEmpty } from '../../components/hub/card-bits';
import { DiscordMessage } from '../scheduling-wireframes/discord-chrome';
import { EMBED_COLOR, type WfEmbedModel } from '../scheduling-wireframes/embed-model';
import { PostItemMock } from './post-mocks';
import { MOCK_GUILD, MOCK_POSTS, deepLink, excerpt, type MockPost } from './hub-posts-mock';

function first(): MockPost {
    const post = MOCK_POSTS[0];
    if (!post) throw new Error('hub-posts mock has no posts');
    return post;
}

/** W4 — Posts tab: newest first, one expanded, optionally one in edit mode. */
export function PostsListMock({ editingId }: { editingId?: number }): JSX.Element {
    return (
        <section aria-label="Posts" data-testid="wf-posts-list">
            <SectionTitle title="Posts" blurb="Everything the guild master and officers have posted, newest first." action={<Button size="sm">New post</Button>} />
            <div className="flex flex-col gap-3">
                {MOCK_POSTS.map((p, i) => (
                    <PostItemMock key={p.id} post={p} editor
                        mode={p.id === editingId ? 'editing' : i === 0 ? 'expanded' : 'collapsed'} />
                ))}
            </div>
            <div className="mt-4 flex justify-center"><Button variant="secondary">Show older posts</Button></div>
        </section>
    );
}

/** W5 — `/guilds/7?post=31#posts`: the linked post leads, highlighted and expanded. */
export function DeepLinkMock({ removed = false }: { removed?: boolean }): JSX.Element {
    return (
        <section aria-label="Linked post" data-testid={`wf-deep-link${removed ? '-removed' : ''}`} className="flex flex-col gap-3">
            <a href="#posts" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
                <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" /> All posts
            </a>
            <p className="font-mono text-xs text-dim">{deepLink(first().id)}</p>
            {removed ? <QuietEmpty>This post was removed. The newest posts are below.</QuietEmpty> : <PostItemMock post={first()} mode="expanded" editor={false} />}
        </section>
    );
}

/** W6 — delete confirm: a Modal at ≥1024px, a BottomSheet below (§4.4). Static picture of both. */
export function DeleteConfirmMock({ layout }: { layout: 'desktop' | 'phone' }): JSX.Element {
    const frame = layout === 'desktop'
        ? 'mx-auto w-full max-w-md rounded-xl border border-edge bg-surface p-5 shadow-lg'
        : 'w-full rounded-t-2xl border border-b-0 border-edge bg-surface p-5';
    return (
        <div className={`flex ${layout === 'desktop' ? 'items-center' : 'items-end'} min-h-[220px] rounded-lg bg-backdrop p-3`}>
            <div role="dialog" aria-label="Delete this post?" className={frame}>
                {layout === 'phone' && <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-edge" aria-hidden="true" />}
                <h3 className="text-base font-semibold text-foreground">Delete this post?</h3>
                <p className="mt-1 text-sm text-secondary">It’s removed here and from #{MOCK_GUILD.channel} in Discord. This can’t be undone.</p>
                <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-edge pt-3">
                    <Button variant="secondary">Keep post</Button>
                    <Button variant="destructive">Delete</Button>
                </div>
            </div>
        </div>
    );
}

function embedFor(post: MockPost): WfEmbedModel {
    return {
        color: EMBED_COLOR.closed,
        authorLine: `📣 ${MOCK_GUILD.name}`,
        title: `New post from ${post.author.name}`,
        lines: excerpt(post.body).split('\n').filter((l) => l !== '').map((text, i) => ({ id: `l${i}`, text })),
        link: null,
        footer: 'Raid Ledger',
        actionRow: [{ id: 'read-more', label: 'Read more ↗', style: 'secondary' }],
        ephemeral: null,
    };
}

/** W7 — the ONE relayed message: opening (≤300 chars) + a "Read more" link button to the deep link. */
export function DiscordRelayMock({ width }: { width: number }): JSX.Element {
    return (
        <div className="overflow-x-auto" data-testid={`wf-discord-${width}`}>
            <DiscordMessage m={embedFor(first())} idPrefix={`wf-relay-${width}`} width={width} />
            <p className="mt-1 text-xs text-muted">Read more → <span className="font-mono">{deepLink(first().id)}</span>. Edits never re-send; delete removes it.</p>
        </div>
    );
}
