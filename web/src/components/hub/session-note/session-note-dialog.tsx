/**
 * ROK-1968 §6.2/§6.4 — the "Before next session" editor: `Modal max-w-lg` at
 * ≥1024px, `BottomSheet 85vh` below (the ValheimOverlay idiom), guarded by
 * `useDirtyCloseGuard`. Save sends `baseUpdatedAt` = the `updatedAt` the draft
 * started from, verbatim. A 409 never overwrites: the draft stays, a §4.7
 * `warning` banner offers "Load their version", which replaces the draft (after
 * a confirm when it has edits) and rebases on the server's note. "Clear note"
 * asks "Clear the note for everyone?" first. Default export for `React.lazy`.
 */
import { useState, type JSX, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { HubSessionNote, HubSessionNoteResponse } from '@raid-ledger/contract';
import { Modal } from '../../ui/modal';
import { BottomSheet } from '../../ui/bottom-sheet';
import { Button } from '../../ui/button';
import { DiscardChangesConfirm, type DiscardCopy } from '../../ui/discard-changes-confirm';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { useDirtyCloseGuard, type DirtyCloseGuard } from '../../../hooks/use-dirty-close-guard';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { SessionNoteForm } from './session-note-form';
import { sessionNoteKey } from './hub-session-note-query';
import { draftError, draftOf, isDirty, toPutBody } from './session-note.helpers';
import { useClearSessionNote, useSaveSessionNote, useSessionNote } from './use-hub-session-note';

export const DIALOG_TITLE = 'Before next session';
export const CONFLICT_COPY = 'Someone else changed this note.';
const LOAD_COPY: DiscardCopy = { title: 'Load their version?', keepLabel: 'Keep editing', discardLabel: 'Load their version' };
const CLEAR_COPY: DiscardCopy = { title: 'Clear the note for everyone?', keepLabel: 'Cancel', discardLabel: 'Clear' };

interface OverlayProps { guard: DirtyCloseGuard; onClose: () => void; footer: ReactNode; children: ReactNode }

function NoteOverlay({ guard, onClose, footer, children }: OverlayProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const shared = { isOpen: true, title: DIALOG_TITLE, onClose, closeGuard: guard, footer, children };
    return isDesktop ? <Modal {...shared} maxWidth="max-w-lg" /> : <BottomSheet {...shared} maxHeight="85vh" />;
}

function Banner({ tone, children }: { tone: 'warning' | 'danger'; children: ReactNode }): JSX.Element {
    const hue = tone === 'warning' ? 'border-warning/30 bg-warning/10 text-warning' : 'border-danger/30 bg-danger/10 text-danger';
    return (
        <div role="alert" data-testid={`session-note-${tone === 'warning' ? 'conflict' : 'error'}`}
            className={`mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${hue}`}>
            {children}
        </div>
    );
}

/** Draft + base note + the save/clear mutations; `loadTheirs` rebases the draft on a 409's note. */
function useNoteEditor(guildId: number, initial: HubSessionNote | null) {
    const client = useQueryClient();
    const [base, setBase] = useState(initial);
    const [draft, setDraft] = useState(() => draftOf(initial));
    const save = useSaveSessionNote(guildId);
    const clear = useClearSessionNote(guildId);
    const loadTheirs = (note: HubSessionNote | null): void => {
        setBase(note);
        setDraft(draftOf(note));
        save.reset();
        void client.invalidateQueries({ queryKey: sessionNoteKey(guildId) });
    };
    return { base, draft, setDraft, save, clear, loadTheirs, dirty: isDirty(draft, draftOf(base)) };
}

type Editor = ReturnType<typeof useNoteEditor>;

interface FooterProps { editor: Editor; onCancel: () => void; onSave: () => void; onClear: () => void }

function DialogFooter({ editor, onCancel, onSave, onClear }: FooterProps): JSX.Element {
    const error = draftError(editor.draft);
    return (
        <div className="flex w-full flex-wrap items-center gap-2">
            {editor.base !== null && (
                <Button variant="destructive-soft" data-testid="session-note-clear" onClick={onClear}>Clear note</Button>
            )}
            <span className="flex-1" />
            {error !== null && <span className="sr-only" id="session-note-save-reason">{error}</span>}
            <Button variant="secondary" data-testid="session-note-cancel" onClick={onCancel}>Cancel</Button>
            <Button data-testid="session-note-save" loading={editor.save.isPending} disabled={error !== null} onClick={onSave}
                {...(error === null ? {} : { 'aria-describedby': 'session-note-save-reason' })}>
                Save
            </Button>
        </div>
    );
}

interface EditorProps { guildId: number; data: HubSessionNoteResponse; onClose: () => void }

function SessionNoteEditor({ guildId, data, onClose }: EditorProps): JSX.Element {
    const editor = useNoteEditor(guildId, data.note);
    const guard = useDirtyCloseGuard(editor.dirty, onClose);
    const [confirm, setConfirm] = useState<'load' | 'clear' | null>(null);
    const conflict = editor.save.conflict;
    const save = (): void => editor.save.mutate(toPutBody(editor.draft, editor.base?.updatedAt ?? null), { onSuccess: onClose });
    const onConfirm = (): void => {
        setConfirm(null);
        if (confirm === 'clear') editor.clear.mutate(undefined, { onSuccess: onClose });
        else if (conflict !== null) editor.loadTheirs(conflict.note);
    };
    const load = (): void => { if (editor.dirty) setConfirm('load'); else if (conflict !== null) editor.loadTheirs(conflict.note); };
    const failed = (editor.save.isError && conflict === null) || editor.clear.isError;
    return (
        <NoteOverlay guard={guard} onClose={onClose}
            footer={<DialogFooter editor={editor} onCancel={guard.requestClose} onSave={save} onClear={() => setConfirm('clear')} />}>
            {conflict !== null && (
                <Banner tone="warning">
                    <span>{CONFLICT_COPY}</span>
                    <Button variant="warning-soft" size="sm" data-testid="session-note-load-theirs" onClick={load}>Load their version</Button>
                </Banner>
            )}
            {failed && <Banner tone="danger">Couldn&apos;t save the note. Try again.</Banner>}
            <SessionNoteForm draft={editor.draft} onChange={editor.setDraft} pinned={editor.base?.clearAfter ?? null} nextEvent={data.nextEvent} />
            <DiscardChangesConfirm isOpen={confirm !== null} onKeep={() => setConfirm(null)} onDiscard={onConfirm}
                copy={confirm === 'clear' ? CLEAR_COPY : LOAD_COPY}
                message={confirm === 'clear' ? 'Members will no longer see the note or its checklist.' : 'Your unsaved changes will be replaced.'} />
        </NoteOverlay>
    );
}

export interface SessionNoteDialogProps { guildId: number; onClose: () => void }

/** Mounted only while open (the dialog store), so every open starts from a fresh draft. */
export default function SessionNoteDialog({ guildId, onClose }: SessionNoteDialogProps): JSX.Element | null {
    const { data } = useSessionNote(guildId);
    if (data === undefined) return null;
    return <SessionNoteEditor guildId={guildId} data={data} onClose={onClose} />;
}
