/**
 * Stacked overlays (ROK-1738): a dialog opened from inside an open Modal —
 * Add Character → "Import LedgerLink character" — is a Modal over the Modal at
 * ≥1024px and a `BottomSheet stacked` below. One Escape must close ONLY the
 * top layer, and a lone overlay must still close on Escape wherever focus is.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { Modal } from './modal';
import { BottomSheet } from './bottom-sheet';

afterEach(cleanup);

const pressEscape = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

/** Focus the button inside the dialog with this accessible name. */
function focusInside(name: string) {
    const dialog = screen.getByRole('dialog', { name });
    dialog.querySelector<HTMLButtonElement>('button[data-inner]')?.focus();
    expect(dialog.contains(document.activeElement), `focus must sit inside "${name}"`).toBe(true);
}

function Host({ onHostClose, onTopClose, sheet }: { onHostClose: () => void; onTopClose: () => void; sheet: boolean }) {
    return (
        <>
            <Modal isOpen onClose={onHostClose} title="Add Character"><button data-inner>host field</button></Modal>
            {sheet
                ? <BottomSheet isOpen onClose={onTopClose} title="Import sheet" stacked><button data-inner>sheet field</button></BottomSheet>
                : <Modal isOpen onClose={onTopClose} title="Import modal"><button data-inner>top field</button></Modal>}
        </>
    );
}

describe('stacked overlays — Escape closes only the top layer', () => {
    it.each([['a Modal over a Modal', false, 'Import modal'], ['a stacked BottomSheet over a Modal', true, 'Import sheet']])(
        '%s: Escape with focus in the top layer closes only it',
        (_label, sheet, topName) => {
            const onHostClose = vi.fn();
            const onTopClose = vi.fn();
            render(<Host onHostClose={onHostClose} onTopClose={onTopClose} sheet={sheet} />);
            focusInside(topName);
            pressEscape();
            expect(onTopClose, 'Escape must close the top layer').toHaveBeenCalledTimes(1);
            expect(onHostClose, 'Escape must NOT also close the dialog underneath').not.toHaveBeenCalled();
        },
    );

    it('with focus on <body>, Escape closes only the most recently opened layer', () => {
        const onHostClose = vi.fn();
        const onTopClose = vi.fn();
        render(<Host onHostClose={onHostClose} onTopClose={onTopClose} sheet />);
        (document.activeElement as HTMLElement | null)?.blur();
        pressEscape();
        expect(onTopClose, 'Escape must close the top layer').toHaveBeenCalledTimes(1);
        expect(onHostClose, 'Escape must NOT also close the dialog underneath').not.toHaveBeenCalled();
    });

    it('a just-opened top layer owns Escape even while focus is still in the host', () => {
        const onHostClose = vi.fn();
        const onTopClose = vi.fn();
        render(<Host onHostClose={onHostClose} onTopClose={onTopClose} sheet={false} />);
        focusInside('Add Character');
        pressEscape();
        expect(onTopClose, 'Escape must close the top layer').toHaveBeenCalledTimes(1);
        expect(onHostClose, 'Escape must NOT also close the dialog underneath').not.toHaveBeenCalled();
    });
});

describe('a lone overlay still closes on Escape', () => {
    it.each([
        ['Modal', (onClose: () => void) => <Modal isOpen onClose={onClose} title="Lone"><p>text</p></Modal>],
        ['BottomSheet', (onClose: () => void) => <BottomSheet isOpen onClose={onClose} title="Lone"><p>text</p></BottomSheet>],
    ])('%s with focus on <body> (a click on non-focusable content)', (_label, ui) => {
        const onClose = vi.fn();
        render(ui(onClose));
        (document.activeElement as HTMLElement | null)?.blur();
        expect(document.activeElement).toBe(document.body);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose, 'a lone overlay must close on Escape').toHaveBeenCalledTimes(1);
    });

    it('a closed overlay ignores Escape and the listener is gone after close', () => {
        const onClose = vi.fn();
        const { rerender } = render(<Modal isOpen onClose={onClose} title="Lone"><p>text</p></Modal>);
        rerender(<Modal isOpen={false} onClose={onClose} title="Lone"><p>text</p></Modal>);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });
});
