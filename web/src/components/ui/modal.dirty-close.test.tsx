/**
 * ROK-1655 — Modal's dirty-close layer. The consumer owns `useDirtyCloseGuard`
 * and hands it to Modal as `closeGuard`: Escape, the backdrop and × then go
 * through `requestClose`, and Modal renders the shared "Discard your changes?"
 * confirm itself. An explicit Cancel is guarded by wiring it to
 * `guard.requestClose`; Save/submit stay unguarded.
 *
 * jsdom note: `offsetParent` is always null here, so `useFocusTrap` finds no
 * tabbable elements and Tab-wrap inside the confirm cannot be asserted. We do
 * not fake it — only initial focus (Keep editing) and focus restoration after
 * Keep are asserted.
 */
import { useRef, useState } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useDirtyCloseGuard } from '../../hooks/use-dirty-close-guard';
import { Modal } from './modal';
import { Button } from './button';

const TITLE = 'Edit character';
const MESSAGE = "Your character edits haven't been saved yet.";

function Harness({ dirty, onClose, onSave }: { dirty: boolean; onClose: () => void; onSave: () => void }) {
    const [open, setOpen] = useState(true);
    const close = () => { onClose(); setOpen(false); };
    const guard = useDirtyCloseGuard(dirty, close);
    const nameRef = useRef<HTMLInputElement>(null);
    const footer = (
        <>
            <Button variant="secondary" onClick={guard.requestClose}>Cancel</Button>
            <Button onClick={onSave}>Save</Button>
        </>
    );
    return (
        <Modal isOpen={open} onClose={close} title={TITLE} closeGuard={guard}
            discardMessage={MESSAGE} initialFocusRef={nameRef} footer={footer}>
            <input ref={nameRef} aria-label="Name" />
        </Modal>
    );
}

function setup(dirty = true) {
    const onClose = vi.fn();
    const onSave = vi.fn();
    render(<Harness dirty={dirty} onClose={onClose} onSave={onSave} />);
    return { onClose, onSave };
}

const parentDialog = () => screen.queryByRole('dialog', { name: TITLE });
const confirmBody = () => screen.queryByTestId('discard-changes-confirm');

/** Escape while dirty; asserts the confirm is up so a missing guard fails here, by name. */
function openConfirm() {
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(confirmBody(), 'Escape while dirty must open "Discard your changes?"').not.toBeNull();
}

const CLOSE_PATHS: Array<[string, () => void]> = [
    ['Escape', () => { fireEvent.keyDown(document, { key: 'Escape' }); }],
    ['the backdrop', () => {
        const backdrop = parentDialog()!.parentElement!.querySelector('[aria-hidden="true"]') as HTMLElement;
        fireEvent.click(backdrop);
    }],
    ['×', () => { fireEvent.click(within(parentDialog()!).getByRole('button', { name: 'Close modal' })); }],
];

afterEach(() => { document.body.style.overflow = ''; });

describe('Modal closeGuard — close paths', () => {
    it.each(CLOSE_PATHS)('%s while dirty opens the confirm and does not close', (_name, act) => {
        const { onClose } = setup(true);
        act();
        expect(confirmBody(), 'a dirty close must show "Discard your changes?"').not.toBeNull();
        expect(confirmBody()).toHaveTextContent(MESSAGE);
        expect(onClose, 'a dirty close must not call onClose').not.toHaveBeenCalled();
        expect(parentDialog(), 'the parent must stay open behind the confirm').not.toBeNull();
    });

    it.each(CLOSE_PATHS)('%s while clean closes at once with no confirm', (_name, act) => {
        const { onClose } = setup(false);
        act();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(confirmBody()).toBeNull();
        expect(parentDialog()).toBeNull();
    });

    it('a footer Cancel wired to guard.requestClose opens the confirm; Save stays unguarded', () => {
        const { onClose, onSave } = setup(true);
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(confirmBody(), 'Save must not be guarded').toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(confirmBody(), 'a guarded Cancel must show the confirm').not.toBeNull();
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('Modal closeGuard — confirm outcomes', () => {
    it('Keep editing closes the confirm, keeps the parent open and never calls onClose', () => {
        const { onClose } = setup(true);
        openConfirm();
        fireEvent.click(screen.getByTestId('discard-changes-keep'));
        expect(confirmBody(), 'Keep must dismiss the confirm').toBeNull();
        expect(parentDialog(), 'Keep must leave the parent open').not.toBeNull();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('Discard calls onClose exactly once and closes both dialogs', () => {
        const { onClose } = setup(true);
        openConfirm();
        fireEvent.click(screen.getByTestId('discard-changes-discard'));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(confirmBody()).toBeNull();
        expect(parentDialog()).toBeNull();
    });
});

describe('Modal closeGuard — Modal over Modal', () => {
    it('one Escape with the confirm open closes only the confirm, and it does not re-open', async () => {
        const { onClose } = setup(true);
        await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus());
        openConfirm();
        const keep = screen.getByTestId('discard-changes-keep');
        await waitFor(() => expect(keep, 'Keep editing must hold focus while the confirm is open').toHaveFocus());

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(confirmBody(), 'the second Escape must close the confirm').toBeNull();
        expect(parentDialog(), 'the parent must survive the same keypress').not.toBeNull();
        expect(onClose, 'the parent Escape listener must not close it').not.toHaveBeenCalled();

        // The latch releases one macrotask later; the confirm must still be gone after it.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(confirmBody(), 'the parent listener must not re-open the confirm (latch)').toBeNull();
        await waitFor(() => expect(parentDialog()!.contains(document.activeElement),
            'focus must return inside the parent dialog after the confirm closes').toBe(true));
    });

    it('Keep editing returns focus inside the parent dialog', async () => {
        setup(true);
        await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus());
        openConfirm();
        await waitFor(() => expect(screen.getByTestId('discard-changes-keep')).toHaveFocus());
        fireEvent.click(screen.getByTestId('discard-changes-keep'));
        await waitFor(() => expect(parentDialog()!.contains(document.activeElement),
            'focus must return inside the parent dialog after Keep').toBe(true));
    });
});
