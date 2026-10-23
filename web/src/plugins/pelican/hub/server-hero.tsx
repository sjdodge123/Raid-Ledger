/**
 * ROK-1831 — the game-server hub's hero pills: the server's live state (game
 * icon + the shared Pelican state chip + "N online") and the Join / Leave pill
 * beside it. Leave asks once inline before it fires (Lead decision).
 */
import { useState, type JSX } from 'react';
import type { HubCtx } from '../../hub-module';
import { Button } from '../../../components/ui/button';
import { FOCUS_RING } from '../../../components/ui/form-classes';
import { PelicanStateChip } from '../slots/pelican-state-chip';
import { useHubJoin } from './server-hub-api';
import { serverHubGameTabs } from './server-hub-game-tabs';

/** The server-side count (sent to visitors too); rows are the fallback for older payloads. */
function onlineCount(ctx: HubCtx): number {
    const sent = ctx.page.server?.onlineCount;
    if (sent !== undefined) return sent;
    return ctx.page.ranks.reduce((n, g) => n + g.members.filter((m) => m.server?.onlineNow === true).length, 0);
}

/** True when this hub shows a per-game Characters tab (Valheim) — the claim nudge's target. */
function hasCharactersTab(ctx: HubCtx): boolean {
    return serverHubGameTabs().some((t) => t.id === 'characters' && (t.visible?.(ctx) ?? true));
}

/**
 * ROK-1932 — the claim nudge: "· N not linked yet" when some online players have no
 * character linked to a Raid Ledger user. A plain `<a href="#characters">` (the
 * hash-tab idiom — `useHashTab` follows hashchange); plain text when the hub has no
 * Characters tab. The tab has no unclaimed filter, so the link lands on the full list.
 */
function UnlinkedNudge(ctx: HubCtx): JSX.Element | null {
    const unlinked = ctx.page.server?.unlinkedOnlineCount;
    if (unlinked === undefined || unlinked <= 0) return null;
    const label = `${unlinked} not linked yet`;
    return (
        <span className="inline-flex items-center gap-1">
            <span aria-hidden="true">·</span>
            {hasCharactersTab(ctx) ? (
                <a href="#characters" data-testid="server-hub-unlinked"
                    className={`-my-3 rounded-sm py-3 font-medium text-success underline-offset-2 hover:underline ${FOCUS_RING}`}>{label}</a>
            ) : (
                <span data-testid="server-hub-unlinked">{label}</span>
            )}
        </span>
    );
}

/** Game icon, server state, how many players are on right now and how many of them are unlinked. */
export function ServerStatusPill(ctx: HubCtx): JSX.Element | null {
    const server = ctx.page.server;
    if (server === undefined) return null;
    return (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="server-hub-status">
            {server.gameIconUrl !== null && (
                <img src={server.gameIconUrl} alt="" className="h-5 w-5 rounded object-cover" data-testid="server-hub-game-icon" />
            )}
            <PelicanStateChip row={{ state: server.state, isSuspended: false }} />
            <span data-testid="server-hub-online">{onlineCount(ctx)} online</span>
            <UnlinkedNudge {...ctx} />
        </span>
    );
}

/** Join, or — once joined — Leave behind a one-step inline confirm. */
export function JoinLeavePill({ page }: HubCtx): JSX.Element | null {
    const join = useHubJoin(page.guild.id);
    const [confirming, setConfirming] = useState(false);
    if (page.server === undefined) return null;
    if (!page.server.viewerJoined) {
        return (
            <Button variant="secondary" size="sm" data-testid="server-hub-join" disabled={join.isPending}
                onClick={() => join.mutate(true)}>Join</Button>
        );
    }
    if (!confirming) {
        return <Button variant="secondary" size="sm" data-testid="server-hub-leave" onClick={() => setConfirming(true)}>Joined · Leave</Button>;
    }
    return (
        <span className="inline-flex items-center gap-1" data-testid="server-hub-leave-confirm">
            <Button variant="destructive-soft" size="sm" data-testid="server-hub-leave-yes"
                onClick={() => { setConfirming(false); join.mutate(false); }}>Leave hub</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
        </span>
    );
}
