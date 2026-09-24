/**
 * ROK-1655 — BottomSheet's dirty-close layer. With a `closeGuard`, every
 * close path (Escape, backdrop, the header ×, swipe-down) asks the guard
 * first: dirty → "Discard your changes?", clean → `onClose` at once. Swipe-up
 * expand and expanded → collapsed are not close paths and never confirm.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BottomSheet } from './bottom-sheet';
import { useDirtyCloseGuard } from '../../hooks/use-dirty-close-guard';

/** The visible viewport (`visualViewport`, via `bottom-sheet-viewport`); a 1000px screen. */
vi.mock('./bottom-sheet-viewport', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./bottom-sheet-viewport')>();
    return { ...actual, useVisibleViewport: () => ({ height: 1000, offsetTop: 0 }) };
});

const TITLE = 'Edit thing';
const MESSAGE = "Your thing hasn't been saved yet.";

interface HarnessProps { dirty: boolean; onClose: () => void; initiallyExpanded?: boolean }

function Harness({ dirty, onClose, initiallyExpanded }: HarnessProps) {
    const guard = useDirtyCloseGuard(dirty, onClose);
    return (
        <BottomSheet
            isOpen onClose={onClose} title={TITLE} closeGuard={guard}
            discardMessage={MESSAGE} initiallyExpanded={initiallyExpanded}
        >
            <p>Sheet body</p>
        </BottomSheet>
    );
}

const sheet = () => screen.getByRole('dialog', { name: TITLE });
const confirm = () => screen.queryByTestId('discard-changes-confirm');
const pressEscape = () => fireEvent.keyDown(document, { key: 'Escape' });
const flushLatch = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** Drag the handle by `delta` px (positive = down). */
function swipe(delta: number) {
    const handle = sheet().querySelector('.cursor-grab') as HTMLElement;
    fireEvent.touchStart(handle, { touches: [{ clientX: 0, clientY: 300 }] });
    fireEvent.touchMove(handle, { touches: [{ clientX: 0, clientY: 300 + delta }] });
    fireEvent.touchEnd(handle);
}

type Row = [string, () => void, Partial<HarnessProps>];
const CLOSE_PATHS: Row[] = [
    ['Escape', pressEscape, {}],
    ['the backdrop', () => fireEvent.click(sheet().parentElement!.querySelector(':scope > [aria-hidden="true"]')!), {}],
    ['the header ×', () => fireEvent.click(screen.getByRole('button', { name: 'Close' })), {}],
    ['swipe-down (collapsed, delta 200)', () => swipe(200), {}],
    ['swipe-down (opened expanded, delta 200)', () => swipe(200), { initiallyExpanded: true }],
];

function setup(dirty: boolean, extra: Partial<HarnessProps> = {}) {
    const onClose = vi.fn();
    render(<Harness dirty={dirty} onClose={onClose} {...extra} />);
    return { onClose };
}

describe('BottomSheet closeGuard — every close path', () => {
    it.each(CLOSE_PATHS)('dirty: %s shows the confirm and does not close', (_name, close, extra) => {
        const { onClose } = setup(true, extra);
        close();
        expect(onClose, 'a dirty close path must not call onClose').not.toHaveBeenCalled();
        expect(confirm(), 'a dirty close path must render DiscardChangesConfirm').not.toBeNull();
        expect(confirm()).toHaveTextContent(MESSAGE);
        expect(sheet()).toBeInTheDocument();
    });

    it.each(CLOSE_PATHS)('clean: %s calls onClose at once', (_name, close, extra) => {
        const { onClose } = setup(false, extra);
        close();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(confirm(), 'a clean close must not ask to discard').toBeNull();
    });
});

describe('BottomSheet closeGuard — the confirm', () => {
    it('Keep editing dismisses the confirm and leaves the sheet open', async () => {
        const { onClose } = setup(true);
        pressEscape();
        expect(confirm(), 'a dirty Escape must open the confirm').not.toBeNull();
        fireEvent.click(screen.getByTestId('discard-changes-keep'));
        await waitFor(() => expect(confirm()).toBeNull());
        expect(onClose).not.toHaveBeenCalled();
        expect(sheet()).toBeInTheDocument();
    });

    it('Discard calls onClose exactly once', () => {
        const { onClose } = setup(true);
        pressEscape();
        expect(confirm(), 'a dirty Escape must open the confirm').not.toBeNull();
        fireEvent.click(screen.getByTestId('discard-changes-discard'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('one Escape with the confirm open closes only the confirm (the latch holds)', async () => {
        const { onClose } = setup(true);
        pressEscape();
        expect(confirm(), 'a dirty Escape must open the confirm').not.toBeNull();
        // Reaches the confirm's document listener AND the sheet's window listener.
        pressEscape();
        await waitFor(() => expect(confirm()).toBeNull());
        await flushLatch();
        expect(confirm(), 'the sheet listener must not re-open the confirm').toBeNull();
        expect(onClose).not.toHaveBeenCalled();
        // The latch releases: the next Escape asks again.
        pressEscape();
        expect(confirm()).not.toBeNull();
    });
});

describe('BottomSheet closeGuard — swipes that are not closes', () => {
    it('swipe-up expands and swipe-down collapses without a confirm', () => {
        const { onClose } = setup(true);
        expect(sheet().style.maxHeight).toBe('600px');
        swipe(-100);
        expect(sheet().style.maxHeight, 'swipe-up must still expand').toBe('950px');
        swipe(100);
        expect(sheet().style.maxHeight, 'expanded → collapsed is unchanged').toBe('600px');
        expect(confirm(), 'expand/collapse is not a close').toBeNull();
        expect(onClose).not.toHaveBeenCalled();
    });
});

/*
 * ROK-1655 review: the parent can close the sheet without the guard (a route
 * change, a programmatic close). The next open must start fresh — no confirm
 * left over, and no latch swallowing the first close.
 */
function Controlled({ open, dirty, onClose }: { open: boolean; dirty: boolean; onClose: () => void }) {
    const guard = useDirtyCloseGuard(dirty, onClose);
    return (
        <BottomSheet isOpen={open} onClose={onClose} title={TITLE} closeGuard={guard} discardMessage={MESSAGE}>
            <p>Sheet body</p>
        </BottomSheet>
    );
}

/** Dirty Escape (confirm up), then the parent closes and reopens it; `dirtyAfter` = the reopened draft. */
function closeExternallyWhileConfirming(dirtyAfter: boolean) {
    const onClose = vi.fn();
    const view = render(<Controlled open dirty onClose={onClose} />);
    pressEscape();
    expect(confirm(), 'a dirty Escape must open the confirm').not.toBeNull();
    view.rerender(<Controlled open={false} dirty onClose={onClose} />);
    expect(confirm(), 'an external close must take the confirm with it').toBeNull();
    view.rerender(<Controlled open dirty={dirtyAfter} onClose={onClose} />);
    return { onClose };
}

describe('BottomSheet closeGuard — closed by another route', () => {
    it('reopening after an external close shows no confirm; one dirty Escape asks afresh', () => {
        const { onClose } = closeExternallyWhileConfirming(true);
        expect(confirm(), 'a reopened sheet must not start in the confirming state').toBeNull();
        pressEscape();
        expect(confirm(), 'the first dirty Escape after reopening must ask to discard').not.toBeNull();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('reopening clean after an external close: one × closes at once (no stuck latch)', () => {
        const { onClose } = closeExternallyWhileConfirming(false);
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose, 'the first clean close after reopening must not be swallowed').toHaveBeenCalledTimes(1);
        expect(confirm()).toBeNull();
    });
});
