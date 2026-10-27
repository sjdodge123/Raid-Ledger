/**
 * ROK-1968 §6.3 — the hub Overview "Before next session" card body (Core):
 * the note's Markdown body, the shared checklist, and a footer "Edited by … ·
 * …" plus the "Clears after <event>" line. Members never reach an empty card
 * (`useSessionNoteVisible`); editors get the one-line §4.5 hint with "Add note".
 * Default export so the registration can `React.lazy` it.
 */
import type { JSX } from 'react';
import type { HubSessionNote } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { MarkdownBlock } from '../../ui/markdown-block';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import { SessionNoteChecklist } from './session-note-checklist';
import { useSessionNoteDialog } from './session-note-dialog-store';
import { editedByLine, formatClearAfter } from './session-note.helpers';
import { useSessionNote, useTickSessionNoteItem } from './use-hub-session-note';

export const SESSION_NOTE_EMPTY_HINT = 'Add a note for next session';

function EditorHint({ guildId }: { guildId: number }): JSX.Element {
    const open = useSessionNoteDialog((s) => s.open);
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 py-2" data-testid="session-note-hint">
            <p className="text-sm text-muted">{SESSION_NOTE_EMPTY_HINT}</p>
            <Button variant="ghost" size="sm" onClick={() => open(guildId)}>Add note</Button>
        </div>
    );
}

function NoteFooter({ note }: { note: HubSessionNote }): JSX.Element {
    return (
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted">
            <span>{editedByLine(note)}</span>
            {note.clearAfter && (
                <span data-testid="session-note-clear-after">
                    Clears after <span className="font-semibold text-foreground">{formatClearAfter(note.clearAfter)}</span>
                </span>
            )}
        </div>
    );
}

export default function HubSessionNoteWidget({ page }: HubWidgetCtx): JSX.Element | null {
    const guildId = page.guild.id;
    const { data } = useSessionNote(guildId);
    const tick = useTickSessionNoteItem(guildId);
    if (data === undefined) return null;
    const { note, viewer } = data;
    if (note === null) return viewer.canEdit ? <EditorHint guildId={guildId} /> : null;
    return (
        <div className="flex flex-col gap-3">
            {note.body.trim() !== '' && <MarkdownBlock text={note.body} testId="session-note-body" />}
            <SessionNoteChecklist items={note.items} canTick={viewer.canTick}
                onTick={(itemId, done) => tick.mutate({ itemId, done })} />
            <NoteFooter note={note} />
        </div>
    );
}
