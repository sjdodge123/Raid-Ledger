/**
 * ROK-2136 — the "Guild message" editor (the session-note dialog idiom):
 * `Modal max-w-lg` at ≥1024px, `BottomSheet 85vh` below, guarded by
 * `useDirtyCloseGuard`. One dialog edits both fields; Save sends both texts and
 * each field's loaded `updatedAt` verbatim. A 409 (per field, D6) never
 * overwrites: the draft stays and a §4.7 `warning` banner offers "Load their
 * version". Opening refetches; a clean draft rebases on the fresh text.
 * Default export for `React.lazy`.
 */
import { useState, type JSX, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { GuildIngameText, IngameTextFieldKey } from '@raid-ledger/contract';
import { Modal } from '../../../components/ui/modal';
import { BottomSheet } from '../../../components/ui/bottom-sheet';
import { Button } from '../../../components/ui/button';
import { DiscardChangesConfirm, type DiscardCopy } from '../../../components/ui/discard-changes-confirm';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { useDirtyCloseGuard, type DirtyCloseGuard } from '../../../hooks/use-dirty-close-guard';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { guildIngameTextKey, useGuildIngameText, useSaveGuildIngameText } from '../hooks/use-guild-ingame-text';
import { GuildTextField } from './guild-text-field';
import { baseStamp, conflictTextOf, draftError, draftOf, isDirty, toPutBody, type GuildTextBase } from './guild-text.helpers';

export const DIALOG_TITLE = 'Guild message';
export const CONFLICT_COPY = 'Someone else changed this text.';
export const PASTE_HINT = 'In game: Guild → Guild Info → click the Message of the Day / Guild Information box, paste, Accept.';
const LOAD_COPY: DiscardCopy = { title: 'Load their version?', keepLabel: 'Keep editing', discardLabel: 'Load their version' };

interface OverlayProps { guard: DirtyCloseGuard; onClose: () => void; footer: ReactNode; children: ReactNode }

function TextOverlay({ guard, onClose, footer, children }: OverlayProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const shared = { isOpen: true, title: DIALOG_TITLE, onClose, closeGuard: guard, footer, children };
    return isDesktop ? <Modal {...shared} maxWidth="max-w-lg" /> : <BottomSheet {...shared} maxHeight="85vh" />;
}

function Banner({ tone, children }: { tone: 'warning' | 'danger'; children: ReactNode }): JSX.Element {
    const hue = tone === 'warning' ? 'border-warning/30 bg-warning/10 text-warning' : 'border-danger/30 bg-danger/10 text-danger';
    return (
        <div role="alert" data-testid={`guild-text-${tone === 'warning' ? 'conflict' : 'error'}`}
            className={`mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${hue}`}>
            {children}
        </div>
    );
}

/** Draft + the base it started from + the save mutation; `loadTheirs` rebases on a 409's text. */
function useTextEditor(guildId: number, initial: GuildIngameText) {
    const client = useQueryClient();
    const [base, setBase] = useState<GuildTextBase>(initial);
    const [draft, setDraft] = useState(() => draftOf(initial));
    const save = useSaveGuildIngameText(guildId);
    const loadTheirs = (theirs: GuildTextBase): void => {
        setBase(theirs);
        setDraft(draftOf(theirs));
        save.reset();
        void client.invalidateQueries({ queryKey: guildIngameTextKey(guildId) });
    };
    const dirty = isDirty(draft, base);
    // A clean editor rebases on a fresher text; a dirty one keeps its base, so a real concurrent change still 409s.
    const fresh = baseStamp(initial);
    const [seen, setSeen] = useState(fresh);
    if (fresh !== seen) {
        setSeen(fresh);
        if (!dirty) { setBase(initial); setDraft(draftOf(initial)); }
    }
    const setField = (field: IngameTextFieldKey) => (value: string): void => setDraft((d) => ({ ...d, [field]: value }));
    return { base, draft, setField, save, loadTheirs, dirty, conflict: conflictTextOf(save.error) };
}

type Editor = ReturnType<typeof useTextEditor>;

function DialogFooter({ editor, onCancel, onSave }: { editor: Editor; onCancel: () => void; onSave: () => void }): JSX.Element {
    const blocked = draftError(editor.draft) !== null;
    return (
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" data-testid="guild-text-cancel" onClick={onCancel}>Cancel</Button>
            <Button data-testid="guild-text-save" loading={editor.save.isPending} disabled={blocked} onClick={onSave}>Save</Button>
        </div>
    );
}

function EditorFields({ editor }: { editor: Editor }): JSX.Element {
    return (
        <div className="flex flex-col gap-4">
            <GuildTextField field="motd" value={editor.draft.motd} onChange={editor.setField('motd')} />
            <GuildTextField field="info" value={editor.draft.info} onChange={editor.setField('info')} />
            <div data-testid="guild-text-paste-hint" className="bg-overlay/30 border border-edge rounded-lg p-4 text-sm text-muted">
                {PASTE_HINT}
            </div>
        </div>
    );
}

interface EditorProps { guildId: number; data: GuildIngameText; onClose: () => void }

function GuildTextEditor({ guildId, data, onClose }: EditorProps): JSX.Element {
    const editor = useTextEditor(guildId, data);
    const guard = useDirtyCloseGuard(editor.dirty, onClose);
    const [confirmLoad, setConfirmLoad] = useState(false);
    const { conflict } = editor;
    const save = (): void => editor.save.mutate(toPutBody(editor.draft, editor.base), { onSuccess: onClose });
    const loadNow = (): void => { setConfirmLoad(false); if (conflict !== null) editor.loadTheirs(conflict); };
    const load = (): void => { if (editor.dirty) setConfirmLoad(true); else loadNow(); };
    const failed = editor.save.isError && conflict === null;
    return (
        <TextOverlay guard={guard} onClose={onClose}
            footer={<DialogFooter editor={editor} onCancel={guard.requestClose} onSave={save} />}>
            {conflict !== null && (
                <Banner tone="warning">
                    <span>{CONFLICT_COPY}</span>
                    <Button variant="warning-soft" size="sm" data-testid="guild-text-load-theirs" onClick={load}>Load their version</Button>
                </Banner>
            )}
            {failed && <Banner tone="danger">Couldn&apos;t save the guild text. Try again.</Banner>}
            <EditorFields editor={editor} />
            <DiscardChangesConfirm isOpen={confirmLoad} onKeep={() => setConfirmLoad(false)} onDiscard={loadNow}
                copy={LOAD_COPY} message="Your unsaved changes will be replaced." />
        </TextOverlay>
    );
}

export interface GuildTextDialogProps { guildId: number; onClose: () => void }

/** Mounted only while open (the dialog store), so every open starts from a fresh draft. */
export default function GuildTextDialog({ guildId, onClose }: GuildTextDialogProps): JSX.Element | null {
    const { data } = useGuildIngameText(guildId, { fresh: true });
    if (data === undefined) return null;
    return <GuildTextEditor guildId={guildId} data={data} onClose={onClose} />;
}
