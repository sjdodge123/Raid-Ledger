/**
 * ROK-1640: "Discard your changes?" — shown when a game-time drawer is closed
 * with unsaved edits (`useDirtyCloseGuard`). No new pattern: the shell is the
 * shared `Modal` (above the sheet: `Z_INDEX.MODAL` > `BOTTOM_SHEET`) and the
 * buttons are the `Button` primitive's secondary + destructive pair (ROK-1646).
 */
import { useRef, type JSX } from 'react';
import { Modal } from '../../ui/modal';
import { Button } from '../../ui/button';

export interface DiscardChangesConfirmProps {
    isOpen: boolean;
    /** "Keep editing", the backdrop and Escape — the draft stays. */
    onKeep: () => void;
    /** "Discard" — close the drawer and drop the draft. */
    onDiscard: () => void;
}

/** See file docstring. */
export function DiscardChangesConfirm({ isOpen, onKeep, onDiscard }: DiscardChangesConfirmProps): JSX.Element {
    const keepRef = useRef<HTMLButtonElement>(null);
    return (
        <Modal isOpen={isOpen} onClose={onKeep} title="Discard your changes?" initialFocusRef={keepRef}>
            <div data-testid="discard-changes-confirm">
                <p className="text-sm text-muted">The times you just entered haven&apos;t been saved yet.</p>
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
