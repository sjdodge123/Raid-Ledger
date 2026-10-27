/**
 * ROK-1968 §6.3 — the note card's `useVisible` probe, loaded eagerly by the
 * Core `register.ts`, so it carries only the light query layer. Members never
 * see an empty card; editors keep it for the "Add a note" hint. Hidden while
 * loading and on the members-only route's 404. Same key as the card body.
 */
import { useQuery } from '@tanstack/react-query';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import { sessionNoteQuery } from './hub-session-note-query';

export function useSessionNoteVisible({ page }: HubWidgetCtx): boolean {
    const { data } = useQuery(sessionNoteQuery(page.guild.id));
    if (data === undefined) return false;
    return data.note !== null || data.viewer.canEdit;
}
