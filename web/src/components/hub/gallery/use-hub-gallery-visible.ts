/**
 * ROK-1942 D12 — the Gallery card's `useVisible` probe, loaded eagerly by the
 * Core `register.ts`, so it carries only the light query layer. ROK-1965 D15:
 * every hub member sees the card, empty too, so someone can add the first
 * picture; a visitor / non-member gets the route's 404 and no card. Same key
 * as the card body, so the body reuses it.
 */
import { useQuery } from '@tanstack/react-query';
import { hubMediaStripQuery } from '../../../lib/hub-media-query';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';

export function useGalleryWidgetVisible({ page }: HubWidgetCtx): boolean {
    const { data } = useQuery(hubMediaStripQuery(page.guild.id, 'all'));
    return data !== undefined;
}
