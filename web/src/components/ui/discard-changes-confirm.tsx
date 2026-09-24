/**
 * "Discard your changes?" — the shared confirm shown when an overlay holding
 * unsaved edits is closed (`useDirtyCloseGuard`, `web/src/hooks`). Born in the
 * game-time drawer (ROK-1640), shared by ROK-1655. No new pattern: the shell is
 * the shared `Modal` (above a sheet: `Z_INDEX.MODAL` > `BOTTOM_SHEET`) and the
 * buttons are the `Button` primitive's secondary + destructive pair (ROK-1646).
 */
import { useRef, type JSX } from 'react';
import { Modal } from './modal';
import { Button } from './button';

/** Neutral copy for callers that do not name what is unsaved. */
export const DEFAULT_DISCARD_MESSAGE = "Your changes haven't been saved yet.";

export interface DiscardChangesConfirmProps {
    isOpen: boolean;
    /** "Keep editing", the backdrop and Escape — the draft stays. */
    onKeep: () => void;
    /** "Discard" — close the overlay and drop the draft. */
    onDiscard: () => void;
    /** What is unsaved, in the caller's words. Defaults to `DEFAULT_DISCARD_MESSAGE`. */
    message?: string;
}

/** See file docstring. */
export function DiscardChangesConfirm({
    isOpen, onKeep, onDiscard, message = DEFAULT_DISCARD_MESSAGE,
}: DiscardChangesConfirmProps): JSX.Element {
    const keepRef = useRef<HTMLButtonElement>(null);
    return (
        <Modal isOpen={isOpen} onClose={onKeep} title="Discard your changes?" initialFocusRef={keepRef}>
            <div data-testid="discard-changes-confirm">
                <p className="text-sm text-muted">{message}</p>
                <div className="mt-4 flex justify-end gap-2">
                    <Button ref={keepRef} variant="secondary" data-testid="discard-changes-keep" onClick={onKeep}>
                        Keep editing
                    </Button>
                    <Button variant="destructive" data-testid="discard-changes-discard" onClick={onDiscard}>
                        Discard
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
