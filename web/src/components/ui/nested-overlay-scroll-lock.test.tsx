/**
 * ROK-1640: "Discard your changes?" is a `Modal` stacked over an open
 * `BottomSheet`. Closing the confirm ("Keep editing") must NOT release the
 * page's body scroll lock while the sheet is still open; closing the sheet
 * must. Both primitives share the ref-counted `useBodyScrollLock`.
 */
import { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BottomSheet } from './bottom-sheet';
import { Modal } from './modal';

function SheetWithConfirm({ onSheetClosed }: { onSheetClosed?: () => void }) {
    const [sheetOpen, setSheetOpen] = useState(true);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const closeSheet = () => { setSheetOpen(false); onSheetClosed?.(); };
    return (
        <BottomSheet isOpen={sheetOpen} onClose={closeSheet} ariaLabel="Editor sheet">
            <button type="button" onClick={() => setConfirmOpen(true)}>Ask to discard</button>
            <button type="button" onClick={closeSheet}>Close sheet</button>
            <Modal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} title="Discard your changes?">
                <button type="button" onClick={() => setConfirmOpen(false)}>Keep editing</button>
            </Modal>
        </BottomSheet>
    );
}

describe('nested overlays share one body scroll lock', () => {
    afterEach(() => { document.body.style.overflow = ''; });

    it('closing a Modal over an open BottomSheet keeps the body locked; closing the sheet unlocks it', () => {
        render(<SheetWithConfirm />);
        expect(document.body.style.overflow).toBe('hidden');

        fireEvent.click(screen.getByRole('button', { name: 'Ask to discard' }));
        expect(screen.getByRole('heading', { name: 'Discard your changes?' })).toBeInTheDocument();
        expect(document.body.style.overflow).toBe('hidden');

        fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
        expect(screen.queryByRole('heading', { name: 'Discard your changes?' })).not.toBeInTheDocument();
        expect(document.body.style.overflow, 'sheet still open, so the body must stay locked').toBe('hidden');

        fireEvent.click(screen.getByRole('button', { name: 'Close sheet' }));
        expect(document.body.style.overflow, 'last overlay closed, so the body must unlock').toBe('');
    });

    it('unmounting the whole stack releases every lock', () => {
        const { unmount } = render(<SheetWithConfirm />);
        fireEvent.click(screen.getByRole('button', { name: 'Ask to discard' }));
        unmount();
        expect(document.body.style.overflow).toBe('');
    });
});
