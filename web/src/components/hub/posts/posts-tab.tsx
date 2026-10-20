/**
 * ROK-1868 W4/W5 — the hub's core Posts tab (every hub kind, no kind-specific
 * code): newest first, "Show older posts" pages, an inline composer for
 * editors, and the `?post=<id>` deep link — expanded, ringed and scrolled to
 * once; a post not on the first page is fetched and leads the list.
 * Lazy-loaded by the hub shell, so none of this rides in the `hub-page` chunk.
 */
import { useState, type JSX } from 'react';
import { useLocation } from 'react-router-dom';
import type { GuildKind, HubPost } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { QuietEmpty } from '../card-bits';
import { SectionTitle } from '../hub-bits';
import { hubCopy } from '../hub-copy';
import { postIdFromSearch, relayOutcomeNotice, type PostNotice } from './hub-post.helpers';
import { LinkedPost } from './linked-post';
import { PostComposer } from './post-composer';
import { PostItem } from './post-item';
import { useHubPosts } from './use-hub-posts';

export interface HubPostsTabProps { guildId: number; canEdit: boolean; isLeader: boolean; kind?: GuildKind | undefined }

function FeedSkeleton(): JSX.Element {
    return (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading posts" data-testid="hub-posts-loading">
            <div className="h-28 animate-pulse rounded-lg border border-edge bg-panel" />
            <div className="h-28 animate-pulse rounded-lg border border-edge bg-panel" />
        </div>
    );
}

interface FeedProps { guildId: number; canEdit: boolean; posts: HubPost[]; highlightId: number | null; hideId: number | null }

function FeedList({ guildId, canEdit, posts, highlightId, hideId }: FeedProps): JSX.Element {
    const shown = posts.filter((p) => p.id !== hideId);
    if (shown.length === 0) return <div data-testid="hub-posts-empty"><QuietEmpty>No posts yet.</QuietEmpty></div>;
    return (
        <div className="flex flex-col gap-3">
            {shown.map((p) => <PostItem key={p.id} guildId={guildId} post={p} canEdit={canEdit} highlighted={p.id === highlightId} />)}
        </div>
    );
}

function Notice({ notice }: { notice: PostNotice | null }): JSX.Element {
    const tone = notice?.tone === 'warning' ? 'text-warning' : 'text-success';
    return <p role="status" className={`mb-3 text-sm empty:hidden ${tone}`} data-testid="hub-posts-relay-notice">{notice?.text}</p>;
}

/** Feed state + where the `?post=<id>` target sits (on the first page, or fetched on its own). */
function useFeed(guildId: number) {
    const linkedId = postIdFromSearch(useLocation().search);
    const feed = useHubPosts(guildId);
    const posts = feed.data?.pages.flatMap((p) => p.posts) ?? [];
    const onFirstPage = linkedId !== null && (feed.data?.pages[0]?.posts ?? []).some((p) => p.id === linkedId);
    const fetchLinked = linkedId !== null && feed.isSuccess && !onFirstPage;
    return { feed, posts, linkedId, highlightId: onFirstPage ? linkedId : null, fetchLinked };
}

/** The Posts tab panel (see file docstring). */
export function HubPostsTab({ guildId, canEdit, isLeader, kind }: HubPostsTabProps): JSX.Element {
    const copy = hubCopy(kind);
    const [composing, setComposing] = useState(false);
    const [notice, setNotice] = useState<PostNotice | null>(null);
    const { feed, posts, linkedId, highlightId, fetchLinked } = useFeed(guildId);
    const action = canEdit && !composing
        ? <Button size="sm" onClick={() => { setNotice(null); setComposing(true); }} data-testid="hub-posts-new">New post</Button>
        : undefined;
    return (
        <section aria-labelledby="hub-posts-title" data-testid="hub-posts-tab">
            <SectionTitle title={copy.postsTab} headingId="hub-posts-title" blurb={copy.postsBlurb} action={action} />
            <Notice notice={notice} />
            {canEdit && composing && (
                <div className="mb-4 rounded-lg border border-edge bg-surface p-4">
                    <PostComposer guildId={guildId} kind={kind} isLeader={isLeader} onCancel={() => setComposing(false)}
                        onPosted={(res, channel) => { setNotice(relayOutcomeNotice(res.relayOutcome, channel)); setComposing(false); }} />
                </div>
            )}
            {fetchLinked && linkedId !== null && <LinkedPost guildId={guildId} postId={linkedId} canEdit={canEdit} removedCopy={copy.postRemoved} />}
            {feed.isPending && <FeedSkeleton />}
            {feed.isError && <p role="alert" className="text-sm text-danger">Couldn’t load the posts. Try again later.</p>}
            {feed.isSuccess && <FeedList guildId={guildId} canEdit={canEdit} posts={posts} highlightId={highlightId} hideId={fetchLinked ? linkedId : null} />}
            {feed.hasNextPage && (
                <div className="mt-4 flex justify-center">
                    <Button variant="secondary" loading={feed.isFetchingNextPage} onClick={() => { void feed.fetchNextPage(); }}>Show older posts</Button>
                </div>
            )}
        </section>
    );
}
