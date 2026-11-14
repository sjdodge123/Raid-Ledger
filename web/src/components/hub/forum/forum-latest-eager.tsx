/**
 * ROK-1175 — the "Latest threads" card's eager parts, imported by the Core
 * `register.ts`: the `useVisible` probe (Q3: members + staff only, hidden
 * while the hub has no threads) and the header action "Open the Forum".
 * Light layer only — the card body is the lazy chunk.
 */
import type { JSX } from 'react';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import { JumpLink } from '../card-bits';
import { useLatestThreads } from './use-hub-forum';

/** Visitors never fetch (the route 403s them); an empty forum hides the card (Q3). */
export function useForumLatestVisible({ page }: HubWidgetCtx): boolean {
    const reader = page.viewer.role !== 'visitor';
    const { data } = useLatestThreads(page.guild.id, reader);
    return reader && data !== undefined && data.total > 0;
}

/** "Open the Forum" → `#forum`. */
export function ForumLatestAction(): JSX.Element {
    return <JumpLink testId="forum-latest-open" href="#forum">Open the Forum</JumpLink>;
}
