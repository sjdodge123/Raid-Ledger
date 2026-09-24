/**
 * Modal — the shared dialog. `ModalFrame` (./modal-frame) draws it; this
 * layer adds the optional ROK-1655 dirty-close guard.
 *
 * Without `closeGuard`, Escape, the backdrop and × call `onClose` (unchanged).
 * With it, they call `closeGuard.requestClose` instead, and Modal renders the
 * shared "Discard your changes?" confirm while `closeGuard.confirming`. The
 * consumer owns `useDirtyCloseGuard(isDirty, onClose)` (web/src/hooks), so it
 * guards an explicit Cancel with `onClick={guard.requestClose}` and leaves
 * Save/submit unguarded. Browser back is out of scope (ROK-1655 ruling 4).
 */
import type { JSX } from 'react';
import type { DirtyCloseGuard } from '../../hooks/use-dirty-close-guard';
import { ModalFrame, type ModalFrameProps } from './modal-frame';
import { DiscardChangesConfirm } from './discard-changes-confirm';

export interface ModalProps extends ModalFrameProps {
    /** Route Escape, backdrop and × through the dirty-close guard (ROK-1655). */
    closeGuard?: DirtyCloseGuard;
    /** What is unsaved, for the confirm. Defaults to its neutral copy. */
    discardMessage?: string;
}

/** See file docstring. */
export function Modal({ closeGuard, discardMessage, onClose, ...frame }: ModalProps): JSX.Element {
    return (
        <>
            <ModalFrame {...frame} onClose={closeGuard?.requestClose ?? onClose} />
            {closeGuard && (
                <DiscardChangesConfirm
                    isOpen={frame.isOpen && closeGuard.confirming}
                    onKeep={closeGuard.keep}
                    onDiscard={closeGuard.discard}
                    message={discardMessage}
                />
            )}
        </>
    );
}
