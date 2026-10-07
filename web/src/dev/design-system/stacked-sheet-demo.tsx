/**
 * /dev/design-system demo for `BottomSheet stacked` (ROK-1738): a sheet opened
 * from inside an open `Modal`. Without `stacked` the sheet sits on
 * `Z_INDEX.BOTTOM_SHEET` (45), under the Modal (50); `stacked` lifts it to the
 * Modal layer and the later portal paints on top. Add Character → "Import
 * LedgerLink character" on a phone is the real adopter.
 */
import { useState, type JSX } from 'react';
import { Modal } from '../../components/ui/modal';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { Button } from '../../components/ui/button';
import { StateFrame } from './design-system-bits';

export function StackedSheetDemo({ triggerClass }: { triggerClass: string }): JSX.Element {
    const [modalOpen, setModalOpen] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    return (
        <StateFrame label="BottomSheet — stacked over a Modal" note="stacked lifts the sheet to the Modal layer, so a sheet opened from inside a Modal renders above it, not under it.">
            <button type="button" className={triggerClass} onClick={() => setModalOpen(true)}>Open host modal</button>
            <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Host modal">
                <Button type="button" variant="secondary" onClick={() => setSheetOpen(true)}>Open stacked sheet</Button>
            </Modal>
            <BottomSheet isOpen={sheetOpen} onClose={() => setSheetOpen(false)} title="Stacked sheet" stacked>
                <p className="text-sm text-secondary">This sheet renders above the host modal.</p>
            </BottomSheet>
        </StateFrame>
    );
}
