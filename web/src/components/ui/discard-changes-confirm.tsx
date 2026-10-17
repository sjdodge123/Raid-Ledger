/**
 * "Discard your changes?" — the shared confirm shown when an overlay holding
 * unsaved edits is closed (`useDirtyCloseGuard`, `web/src/hooks`). Born in the
 * game-time drawer (ROK-1640), shared by ROK-1655; `Modal`'s `closeGuard`
 * renders it. No new pattern: the shell is `ModalFrame` (above a sheet:
 * `Z_INDEX.MODAL` > `BOTTOM_SHEET`) and the buttons are the `Button`
 * primitive's secondary + destructive pair (ROK-1646). It uses the unguarded
 * frame, not `Modal`, so the confirm is never itself guarded and no
 * modal.tsx <-> discard-changes-confirm.tsx import cycle forms.
 */
import { useRef, type JSX } from 'react';
import { ModalFrame } from './modal-frame';
import { Button } from './button';

/** Neutral copy for callers that do not name what is unsaved. */
export const DEFAULT_DISCARD_MESSAGE = "Your changes haven't been saved yet.";

/**
 * Title + button labels, for an overlay whose close loses something other
 * than an edit (TDB:1928: the one-time admin password, "Leave without copying
 * the password?" / Stay / Leave). Each defaults to the edit wording.
 */
export interface DiscardCopy {
    title?: string | undefined;
    keepLabel?: string | undefined;
    discardLabel?: string | undefined;
}

export interface DiscardChangesConfirmProps {
    isOpen: boolean;
    /** "Keep editing", the backdrop and Escape — the draft stays. */
    onKeep: () => void;
    /** "Discard" — close the overlay and drop the draft. */
    onDiscard: () => void;
    /** What is unsaved, in the caller's words. Defaults to `DEFAULT_DISCARD_MESSAGE`. */
    message?: string | undefined;
    /** Title/label override (`DiscardCopy`). Defaults to the edit wording. */
    copy?: DiscardCopy | undefined;
    /** Layer override — above a `stacked` sheet (ROK-1738). Default `Z_INDEX.MODAL`. */
    zIndex?: number | undefined;
}

/** See file docstring. */
export function DiscardChangesConfirm({
    isOpen, onKeep, onDiscard, message = DEFAULT_DISCARD_MESSAGE, copy, zIndex,
}: DiscardChangesConfirmProps): JSX.Element {
    const keepRef = useRef<HTMLButtonElement>(null);
    const title = copy?.title ?? 'Discard your changes?';
    return (
        <ModalFrame isOpen={isOpen} onClose={onKeep} title={title} initialFocusRef={keepRef} zIndex={zIndex}>
            <div data-testid="discard-changes-confirm">
                <p className="text-sm text-muted">{message}</p>
                <div className="mt-4 flex justify-end gap-2">
                    <Button ref={keepRef} variant="secondary" data-testid="discard-changes-keep" onClick={onKeep}>
                        {copy?.keepLabel ?? 'Keep editing'}
                    </Button>
                    <Button variant="destructive" data-testid="discard-changes-discard" onClick={onDiscard}>
                        {copy?.discardLabel ?? 'Discard'}
                    </Button>
                </div>
            </div>
        </ModalFrame>
    );
}
