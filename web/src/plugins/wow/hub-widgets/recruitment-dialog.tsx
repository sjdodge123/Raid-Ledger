/**
 * ROK-1789 — the guild Recruitment editor (the guild-text dialog idiom):
 * `Modal max-w-lg` at ≥1024px, `BottomSheet 85vh` below, guarded by
 * `useDirtyCloseGuard`. Fields: the Recruiting checkbox (Q-A5 — off keeps the
 * list), the wanted rows, the apply link; a preview of the derived headline.
 * Save PUTs the whole object (A-D4); "Clear recruitment" DELETEs after a
 * confirm. Validation is the contract schema, shown inline (AC6).
 * Default export for `React.lazy` (the card's `DialogMount`).
 */
import { useState, type JSX, type ReactNode } from 'react';
import type { GuildRecruitmentView } from '@raid-ledger/contract';
import { Modal } from '../../../components/ui/modal';
import { BottomSheet } from '../../../components/ui/bottom-sheet';
import { Button } from '../../../components/ui/button';
import { DialogBanner } from '../../../components/ui/dialog-banner';
import { DiscardChangesConfirm, type DiscardCopy } from '../../../components/ui/discard-changes-confirm';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { useDirtyCloseGuard, type DirtyCloseGuard } from '../../../hooks/use-dirty-close-guard';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { useClearGuildRecruitment, useGuildRecruitment, useSaveGuildRecruitment } from '../hooks/use-guild-recruitment';
import { RecruitmentFields } from './recruitment-fields';
import { draftErrors, draftOf, hasDraftErrors, isDirty, toPutBody, type RecruitmentDraft } from './recruitment.helpers';

export const DIALOG_TITLE = 'Recruitment';
const CLEAR_COPY: DiscardCopy = { title: 'Clear recruitment?', keepLabel: 'Keep it', discardLabel: 'Clear recruitment' };
const CLEAR_MESSAGE = 'Members stop seeing the Recruitment card. The list, states and link are removed.';

interface OverlayProps { guard: DirtyCloseGuard; onClose: () => void; busy: boolean; footer: ReactNode; children: ReactNode }

/** `busy` (a save or clear in flight) locks the close affordances (design-system Modal, ROK-2068). */
function RecruitmentOverlay({ guard, onClose, busy, footer, children }: OverlayProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const shared = { isOpen: true, title: DIALOG_TITLE, onClose, closeGuard: guard, closeDisabled: busy, footer, children };
    return isDesktop ? <Modal {...shared} maxWidth="max-w-lg" /> : <BottomSheet {...shared} maxHeight="85vh" />;
}

/** Draft + the view it started from + the save / clear mutations. A clean draft rebases on a fresher view. */
function useRecruitmentEditor(guildId: number, initial: GuildRecruitmentView) {
    const [base, setBase] = useState(initial);
    const [draft, setDraft] = useState<RecruitmentDraft>(() => draftOf(initial));
    const save = useSaveGuildRecruitment(guildId);
    const clear = useClearGuildRecruitment(guildId);
    const dirty = isDirty(draft, base);
    if (initial.updatedAt !== base.updatedAt && !dirty && !save.isPending) {
        setBase(initial);
        setDraft(draftOf(initial));
    }
    const busy = save.isPending || clear.isPending;
    return { base, draft, setDraft, save, clear, dirty, busy, errors: draftErrors(draft) };
}

type Editor = ReturnType<typeof useRecruitmentEditor>;

interface FooterProps { editor: Editor; onCancel: () => void; onSave: () => void; onClear: () => void }

function DialogFooter({ editor, onCancel, onSave, onClear }: FooterProps): JSX.Element {
    return (
        <div className="flex w-full flex-wrap items-center gap-2">
            {editor.base.recruitment !== null && (
                <Button variant="ghost" data-testid="recruitment-clear" loading={editor.clear.isPending}
                    disabled={editor.save.isPending} onClick={onClear}>
                    Clear recruitment
                </Button>
            )}
            <span className="flex-1" />
            <Button variant="secondary" data-testid="recruitment-cancel" disabled={editor.busy} onClick={onCancel}>Cancel</Button>
            <Button data-testid="recruitment-save" loading={editor.save.isPending}
                disabled={editor.clear.isPending || hasDraftErrors(editor.errors)} onClick={onSave}>Save</Button>
        </div>
    );
}

interface EditorProps { guildId: number; gameSlug: string | undefined; data: GuildRecruitmentView; onClose: () => void }

function RecruitmentEditor({ guildId, gameSlug, data, onClose }: EditorProps): JSX.Element {
    const editor = useRecruitmentEditor(guildId, data);
    const guard = useDirtyCloseGuard(editor.dirty, onClose);
    const [confirmClear, setConfirmClear] = useState(false);
    const save = (): void => editor.save.mutate(toPutBody(editor.draft), { onSuccess: onClose });
    const clearNow = (): void => { setConfirmClear(false); editor.clear.mutate(undefined, { onSuccess: onClose }); };
    return (
        <RecruitmentOverlay guard={guard} onClose={onClose} busy={editor.busy} footer={
            <DialogFooter editor={editor} onCancel={guard.requestClose} onSave={save} onClear={() => setConfirmClear(true)} />
        }>
            {editor.save.isError && <DialogBanner tone="danger" testId="recruitment-save-error">Couldn&apos;t save recruitment. Try again.</DialogBanner>}
            {editor.clear.isError && <DialogBanner tone="danger" testId="recruitment-clear-error">Couldn&apos;t clear recruitment. Try again.</DialogBanner>}
            <RecruitmentFields draft={editor.draft} errors={editor.errors} gameSlug={gameSlug} setDraft={editor.setDraft} />
            <DiscardChangesConfirm isOpen={confirmClear} onKeep={() => setConfirmClear(false)} onDiscard={clearNow}
                copy={CLEAR_COPY} message={CLEAR_MESSAGE} />
        </RecruitmentOverlay>
    );
}

export interface RecruitmentDialogProps {
    guildId: number;
    /** The hub's game slug: picks the class list (A-D7 — 9 Classic classes on Forever). */
    gameSlug?: string | undefined;
    /** Closes the editor (clears `useRecruitmentDialog`). */
    onClose: () => void;
}

/** Mounted only while open (the dialog store), so every open starts from a fresh draft. */
export default function RecruitmentDialog({ guildId, gameSlug, onClose }: RecruitmentDialogProps): JSX.Element | null {
    const { data } = useGuildRecruitment(guildId, { fresh: true });
    if (data === undefined) return null;
    return <RecruitmentEditor guildId={guildId} gameSlug={gameSlug} data={data} onClose={onClose} />;
}
