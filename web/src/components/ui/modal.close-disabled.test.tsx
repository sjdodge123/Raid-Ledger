/**
 * ROK-2068 — Modal's `closeDisabled`: while a request is in flight, Escape, the
 * backdrop and the header × do nothing (neither `onClose` nor the dirty-close
 * guard's `requestClose`) and × is disabled. It defaults off.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DirtyCloseGuard } from '../../hooks/use-dirty-close-guard';
import { Modal } from './modal';

const TITLE = 'Remove 2 playthroughs?';

function fakeGuard(): DirtyCloseGuard {
    return { requestClose: vi.fn(), confirming: false, keep: vi.fn(), discard: vi.fn(), reset: vi.fn() };
}

function setup(opts: { closeDisabled?: boolean; guard?: DirtyCloseGuard }) {
    const onClose = vi.fn();
    render(
        <Modal isOpen onClose={onClose} title={TITLE}
            {...(opts.closeDisabled === undefined ? {} : { closeDisabled: opts.closeDisabled })}
            {...(opts.guard ? { closeGuard: opts.guard } : {})}>
            <p>Body</p>
        </Modal>,
    );
    return { onClose };
}

function backdrop(): Element {
    const el = screen.getByRole('dialog', { name: TITLE }).parentElement?.querySelector(':scope > [aria-hidden="true"]');
    if (!el) throw new Error('modal backdrop not found');
    return el;
}

const closeButton = () => screen.getByRole('button', { name: 'Close modal' });

const CLOSE_PATHS: Array<[string, () => void]> = [
    ['Escape', () => { fireEvent.keyDown(document, { key: 'Escape' }); }],
    ['the backdrop', () => { fireEvent.click(backdrop()); }],
    ['the header ×', () => { fireEvent.click(closeButton()); }],
];

describe('Modal closeDisabled (ROK-2068)', () => {
    it.each(CLOSE_PATHS)('unguarded: %s does not call onClose', (_name, close) => {
        const { onClose } = setup({ closeDisabled: true });
        close();
        expect(onClose, 'a close path must do nothing while closeDisabled').not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: TITLE })).toBeInTheDocument();
    });

    it.each(CLOSE_PATHS)('guarded: %s calls neither onClose nor requestClose', (_name, close) => {
        const guard = fakeGuard();
        const { onClose } = setup({ closeDisabled: true, guard });
        close();
        expect(guard.requestClose, 'the dirty-close guard must not be asked while closeDisabled').not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('disables the header ×', () => {
        setup({ closeDisabled: true });
        expect(closeButton()).toBeDisabled();
    });

    it('defaults off: × is enabled and Escape closes', () => {
        const { onClose } = setup({});
        expect(closeButton()).toBeEnabled();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
