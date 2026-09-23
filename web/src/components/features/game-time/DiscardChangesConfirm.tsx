/**
 * ROK-1640: "Discard your changes?" — shown when a game-time drawer is closed
 * with unsaved edits (`useDirtyCloseGuard`). No new pattern: the shell is the
 * shared `Modal` (above the sheet: `Z_INDEX.MODAL` > `BOTTOM_SHEET`), the
 * buttons copy the house confirm pair, and every colour is a token.
 */
import { useRef, type JSX } from 'react';
import { Modal } from '../../ui/modal';

export interface DiscardChangesConfirmProps {
    isOpen: boolean;
    /** "Keep editing", the backdrop and Escape — the draft stays. */
    onKeep: () => void;
    /** "Discard" — close the drawer and drop the draft. */
    onDiscard: () => void;
}

const BUTTON = 'min-h-[44px] px-4 py-2 text-sm font-medium rounded-lg transition-colors';

/** See file docstring. */
export function DiscardChangesConfirm({ isOpen, onKeep, onDiscard }: DiscardChangesConfirmProps): JSX.Element {
    const keepRef = useRef<HTMLButtonElement>(null);
    return (
        <Modal isOpen={isOpen} onClose={onKeep} title="Discard your changes?" initialFocusRef={keepRef}>
            <div data-testid="discard-changes-confirm">
                <p className="text-sm text-muted">The times you just entered haven&apos;t been saved yet.</p>
                <div className="mt-4 flex justify-end gap-2">
                    <button
                        ref={keepRef} type="button" data-testid="discard-changes-keep" onClick={onKeep}
                        className={`${BUTTON} border border-edge text-foreground hover:bg-panel-hover`}
                    >
                        Keep editing
                    </button>
                    <button
                        type="button" data-testid="discard-changes-discard" onClick={onDiscard}
                        className={`${BUTTON} bg-danger text-white hover:bg-danger/90`}
                    >
                        Discard
                    </button>
                </div>
            </div>
        </Modal>
    );
}
