/**
 * ROK-1942 D12 — the Gallery card's `useVisible` probe, loaded eagerly by the
 * Valheim `register.ts`, so it carries only the light query layer. Members
 * never see an empty card (total 0, or the members-only route's 404); editors
 * keep it for the one-line hint. Same key as the card body, so the body reuses it.
 */
import { useQuery } from '@tanstack/react-query';
import { hubMediaStripQuery } from '../../../lib/hub-media-query';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';

export function useGalleryWidgetVisible({ page }: HubWidgetCtx): boolean {
    const { data } = useQuery(hubMediaStripQuery(page.guild.id, 'all'));
    if (data === undefined) return false;
    return data.total > 0 || page.viewer.canEdit;
}
