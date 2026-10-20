/**
 * ROK-1868 — leader posts in the shared hub shell. DEMO_MODE-gated, dev-only
 * wireframe for the operator to look at before implementation. Implements the
 * operator rulings of 2026-10-20 (spec `planning-artifacts/specs/ROK-1868.md`):
 * a per-post "Also post to Discord" switch (disabled with a hint when no channel
 * is linked), the newest post on Overview + "Previous posts", the Posts tab
 * (newest first, expandable, edit in place), the per-post deep link, and the one
 * relayed Discord message with its "Read more" button. Mocked data only.
 *
 * Gated like `ServerScheduleWireframesPage`: `useSystemStatus().demoMode`,
 * redirect to `/` when false, lazily imported from `lazy-routes.ts`.
 * Route: /dev/wireframes/hub-posts
 */
import { useState, type JSX, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSystemStatus } from '../../hooks/use-system-status';
import { SchemeSwitcher, SideBySideToggle } from '../design-system/scheme-controls';
import { useForcedDarkRoot } from '../design-system/scheme-hooks';
import { DualFamily } from '../design-system/dual-family';
import { Card } from '../../components/hub/hub-bits';
import { ComposerMock, LatestPostCardMock } from './post-mocks';
import { DeepLinkMock, DeleteConfirmMock, DiscordRelayMock, PostsListMock } from './posts-view-mocks';
import { MOCK_POSTS } from './hub-posts-mock';

function useDemoMode(): { ready: boolean; allowed: boolean } {
    const { data, isLoading } = useSystemStatus();
    if (isLoading) return { ready: false, allowed: false };
    return { ready: true, allowed: data?.demoMode === true };
}

/** A titled frame: the desktop rendering beside a 390px phone rendering. */
function Frame({ id, title, note, desktop, phone }: { id: string; title: string; note: string; desktop: ReactNode; phone: ReactNode }): JSX.Element {
    return (
        <section id={id} className="scroll-mt-4 space-y-2" data-testid={`wf-frame-${id}`}>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-muted">{note}</p>
            <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1 basis-[560px]">
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-dim">Desktop</div>
                    {desktop}
                </div>
                <div className="w-[390px] max-w-full shrink-0">
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-dim">Phone · 390px</div>
                    <div className="rounded-xl border border-edge bg-backdrop p-3">{phone}</div>
                </div>
            </div>
        </section>
    );
}

const latest = MOCK_POSTS[0];

function Frames(): JSX.Element {
    if (!latest) return <p className="text-sm text-muted">No mock posts.</p>;
    return (
        <div className="space-y-10">
            <Frame id="w1" title="W1 — Composer, channel linked" note="Switch starts at the hub’s remembered default; the helper line names the channel and says edits stay here."
                desktop={<Card><ComposerMock channel="ok" /></Card>} phone={<Card><ComposerMock channel="ok" /></Card>} />
            <Frame id="w1b" title="W1b — Composer, no channel linked" note="Switch disabled, never hidden; the reason is the helper line (an officer reads “Your guild master can link…”)."
                desktop={<Card><ComposerMock channel="unset" /></Card>} phone={<Card><ComposerMock channel="unset" /></Card>} />
            <Frame id="w2" title="W2 — Overview: latest post (member and editor)" note="Same card, slot and pill as today’s GM post. “Previous posts” jumps to the Posts tab; long posts clamp at 12 lines."
                desktop={<div className="grid grid-cols-2 gap-4"><div className="col-span-2"><LatestPostCardMock post={latest} editor /></div></div>}
                phone={<LatestPostCardMock post={latest} editor={false} />} />
            <Frame id="w2b" title="W2b — Overview: editor clicked “New post”" note="The composer opens inline above the current post — no overlay (D9)."
                desktop={<LatestPostCardMock post={latest} editor composing />} phone={<LatestPostCardMock post={latest} editor composing />} />
            <Frame id="w3" title="W3 — Posts tab: newest first, one expanded" note="Collapsed items clamp at 6 lines. “In Discord” marks relayed posts. Any leader or officer can edit or delete any post."
                desktop={<PostsListMock />} phone={<PostsListMock />} />
            <Frame id="w3b" title="W3b — Posts tab: editing a post" note="Edit in place. A relayed post warns that Discord is not changed (ruling: edits never re-send)."
                desktop={<PostsListMock editingId={27} />} phone={<PostsListMock editingId={27} />} />
            <Frame id="w4" title="W4 — Deep link /guilds/7?post=31#posts" note="The linked post leads, expanded and outlined; “All posts” returns to the list. A deleted post’s link explains itself."
                desktop={<DeepLinkMock />} phone={<DeepLinkMock removed />} />
            <Frame id="w5" title="W5 — Delete confirm" note="Modal at ≥1024px, bottom sheet below (§4.4)."
                desktop={<DeleteConfirmMock layout="desktop" />} phone={<DeleteConfirmMock layout="phone" />} />
            <Frame id="w6" title="W6 — The relayed Discord message" note="ONE message per post: the opening (≤300 chars, word boundary) and a “Read more” link button to the post. Painted in Discord’s colours on purpose."
                desktop={<DiscordRelayMock width={560} />} phone={<DiscordRelayMock width={360} />} />
        </div>
    );
}

export function HubPostsWireframesPage(): JSX.Element | null {
    const { ready, allowed } = useDemoMode();
    const [sideBySide, setSideBySide] = useState(false);
    useForcedDarkRoot(sideBySide);
    if (!ready) return null;
    if (!allowed) return <Navigate to="/" replace />;
    const frames = <Frames />;
    return (
        <div className="mx-auto max-w-7xl px-4 py-6">
            <header className="mb-5 border-b border-edge pb-3">
                <h1 className="text-xl font-semibold text-foreground">ROK-1868 — Leader posts</h1>
                <p className="mt-1 text-sm text-secondary">
                    The hub’s single leader message becomes a post feed in the shared shell (WoW guilds and game servers alike).
                    Mocked data only — nothing here talks to the API. Spec: <code className="rounded bg-panel px-1">planning-artifacts/specs/ROK-1868.md</code>.
                </p>
            </header>
            <div className="mb-6 flex flex-wrap items-center gap-3">
                <SchemeSwitcher />
                <SideBySideToggle active={sideBySide} onToggle={() => setSideBySide((v) => !v)} />
            </div>
            {sideBySide ? <DualFamily>{frames}</DualFamily> : frames}
        </div>
    );
}
