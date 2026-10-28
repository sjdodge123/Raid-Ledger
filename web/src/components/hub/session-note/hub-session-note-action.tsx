/**
 * ROK-1968 §6.2 — the card's header action: a ghost "Edit" for editors once a
 * note exists (the empty card carries its own "Add note"); nothing for members.
 * Imported eagerly by the Core `register.ts`, so it uses only the light query
 * layer and the dialog store, never the dialog chunk.
 */
import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../ui/button';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import { sessionNoteQuery } from './hub-session-note-query';
import { useSessionNoteDialog } from './session-note-dialog-store';

export function HubSessionNoteAction({ page }: HubWidgetCtx): JSX.Element | null {
    const guildId = page.guild.id;
    const { data } = useQuery(sessionNoteQuery(guildId));
    const open = useSessionNoteDialog((s) => s.open);
    if (data?.note == null || !data.viewer.canEdit) return null;
    return (
        <Button variant="ghost" size="sm" data-testid="session-note-edit" onClick={() => open(guildId)}>
            Edit
        </Button>
    );
}
