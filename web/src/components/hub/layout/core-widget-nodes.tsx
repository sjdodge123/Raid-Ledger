/**
 * ROK-1918 — the two lazy core Overview widgets, split out of the catalog so
 * that module exports only functions (react-refresh) and these stay lazy.
 */
import { lazy, Suspense, type JSX } from 'react';
import type { LatestPostCardProps } from '../posts/latest-post-card';
import type { GuildKind } from '@raid-ledger/contract';

/**
 * ROK-1868 §3.4 — lazy so the post card, composer and post hooks (shared with
 * the lazy Posts tab) stay out of the `hub-page` chunk. The fallback holds the
 * card's two-column cell so the grid doesn't jump when it lands.
 */
const LatestPostCard = lazy(() => import('../posts/latest-post-card').then((m) => ({ default: m.LatestPostCard })));

/**
 * ROK-1788: lazy so the mirror (and its editor-only picker, a further lazy
 * chunk) stays out of the guild-page chunk. Fallback `null` matches the card's
 * own loading state, which renders nothing until the mirror query settles.
 */
const GuildDiscordMirror = lazy(() => import('../discord/guild-discord-mirror').then((m) => ({ default: m.GuildDiscordMirror })));

function PostCellSkeleton(): JSX.Element {
    return <div className="h-32 animate-pulse rounded-lg border border-edge bg-panel md:col-span-2" aria-busy="true" data-testid="guild-gm-post-loading" />;
}

export function LazyLatestPostCard(props: LatestPostCardProps): JSX.Element {
    return <Suspense fallback={<PostCellSkeleton />}><LatestPostCard {...props} /></Suspense>;
}

interface DiscordMirrorNodeProps {
    guildId: number;
    canEdit: boolean;
    onChangeChannel: (() => void) | null;
    kind: GuildKind;
}

export function LazyDiscordMirror(props: DiscordMirrorNodeProps): JSX.Element {
    return <Suspense fallback={null}><GuildDiscordMirror {...props} /></Suspense>;
}
