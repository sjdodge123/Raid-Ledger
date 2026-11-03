/**
 * ROK-2068 — BottomSheet's `closeDisabled`: while a request is in flight,
 * Escape, the backdrop, the header × and swipe-down do nothing (neither
 * `onClose` nor the dirty-close guard's `requestClose`) and × is disabled. It
 * defaults off.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DirtyCloseGuard } from '../../hooks/use-dirty-close-guard';
import { BottomSheet } from './bottom-sheet';

/** The visible viewport (`visualViewport`, via `bottom-sheet-viewport`); a 1000px screen. */
vi.mock('./bottom-sheet-viewport', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./bottom-sheet-viewport')>();
    return { ...actual, useVisibleViewport: () => ({ height: 1000, offsetTop: 0 }) };
});

const TITLE = 'Manage my saves';

interface SetupOpts { closeDisabled?: boolean; guard?: DirtyCloseGuard; initiallyExpanded?: boolean }

function setup(opts: SetupOpts) {
    const onClose = vi.fn();
    render(
        <BottomSheet isOpen onClose={onClose} title={TITLE}
            {...(opts.closeDisabled === undefined ? {} : { closeDisabled: opts.closeDisabled })}
            {...(opts.guard ? { closeGuard: opts.guard } : {})}
            {...(opts.initiallyExpanded === undefined ? {} : { initiallyExpanded: opts.initiallyExpanded })}>
            <p>Sheet body</p>
        </BottomSheet>,
    );
    return { onClose };
}

const sheet = () => screen.getByRole('dialog', { name: TITLE });
const closeButton = () => screen.getByRole('button', { name: 'Close' });

function must(el: Element | null | undefined, label: string): Element {
    if (!el) throw new Error(`${label} not found`);
    return el;
}

/** Drag the handle by `delta` px (positive = down). */
function swipe(delta: number): void {
    const handle = must(sheet().querySelector('.cursor-grab'), 'drag handle');
    fireEvent.touchStart(handle, { touches: [{ clientX: 0, clientY: 300 }] });
    fireEvent.touchMove(handle, { touches: [{ clientX: 0, clientY: 300 + delta }] });
    fireEvent.touchEnd(handle);
}

type Row = [string, () => void, Partial<SetupOpts>];
const CLOSE_PATHS: Row[] = [
    ['Escape', () => { fireEvent.keyDown(document, { key: 'Escape' }); }, {}],
    ['the backdrop', () => { fireEvent.click(must(sheet().parentElement?.querySelector(':scope > [aria-hidden="true"]'), 'backdrop')); }, {}],
    ['the header ×', () => { fireEvent.click(closeButton()); }, {}],
    ['swipe-down (collapsed, delta 200)', () => swipe(200), {}],
    ['swipe-down (opened expanded, delta 200)', () => swipe(200), { initiallyExpanded: true }],
];

function fakeGuard(): DirtyCloseGuard {
    return { requestClose: vi.fn(), confirming: false, keep: vi.fn(), discard: vi.fn(), reset: vi.fn() };
}

describe('BottomSheet closeDisabled (ROK-2068)', () => {
    it.each(CLOSE_PATHS)('unguarded: %s does not call onClose', (_name, close, extra) => {
        const { onClose } = setup({ closeDisabled: true, ...extra });
        close();
        expect(onClose, 'a close path must do nothing while closeDisabled').not.toHaveBeenCalled();
        expect(sheet()).toBeInTheDocument();
    });

    it.each(CLOSE_PATHS)('guarded: %s calls neither onClose nor requestClose', (_name, close, extra) => {
        const guard = fakeGuard();
        const { onClose } = setup({ closeDisabled: true, guard, ...extra });
        close();
        expect(guard.requestClose, 'the dirty-close guard must not be asked while closeDisabled').not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('disables the header ×', () => {
        setup({ closeDisabled: true });
        expect(closeButton()).toBeDisabled();
    });

    it('defaults off: × is enabled and swipe-down closes', () => {
        const { onClose } = setup({});
        expect(closeButton()).toBeEnabled();
        swipe(200);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
