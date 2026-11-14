/**
 * ROK-1175 — the "Latest threads" card's `useVisible` probe, imported eagerly
 * by the Core `register.ts` (light query layer only): members + staff (Q1),
 * hidden while the hub has no threads (Q3). Visitors never fetch.
 */
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import { useLatestThreads } from './use-hub-forum';

export function useForumLatestVisible({ page }: HubWidgetCtx): boolean {
    const reader = page.viewer.role !== 'visitor';
    const { data } = useLatestThreads(page.guild.id, reader);
    return reader && data !== undefined && data.total > 0;
}
