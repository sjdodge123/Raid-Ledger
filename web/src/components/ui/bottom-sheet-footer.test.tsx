import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BottomSheet } from './bottom-sheet';
import { Modal } from './modal';

/** The visible viewport (`visualViewport`, via `bottom-sheet-viewport`); a 1000px screen. */
vi.mock('./bottom-sheet-viewport', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./bottom-sheet-viewport')>();
    return { ...actual, useVisibleViewport: () => ({ height: 1000, offsetTop: 0 }) };
});

type SheetProps = Partial<React.ComponentProps<typeof BottomSheet>>;

function renderSheet(props: SheetProps = {}) {
    return render(
        <BottomSheet isOpen onClose={() => {}} title="Reschedule" {...props}>
            <p>Sheet body</p>
        </BottomSheet>,
    );
}

const footer = <button type="button">Save</button>;

/** The scroll body is the element carrying overflow-y-auto that wraps the children. */
function scrollBody() {
    const body = screen.getByText('Sheet body').parentElement;
    if (!body) throw new Error('children have no wrapper');
    return body;
}

/** The pinned footer: a shrink-0 sibling after the scroll body, never inside it. */
function expectPinnedFooter() {
    const dialog = screen.getByRole('dialog');
    const body = scrollBody();
    const found = screen.queryByTestId('bottom-sheet-footer');
    expect(found, 'BottomSheet rendered no [data-testid=bottom-sheet-footer] slot').not.toBeNull();
    const pinned = found as HTMLElement;
    expect(body.className).toContain('overflow-y-auto');
    expect(body.className).toContain('min-h-0');
    expect(body.contains(pinned)).toBe(false);
    expect(pinned.parentElement).toBe(dialog);
    expect(body.nextElementSibling).toBe(pinned);
    expect(dialog.lastElementChild).toBe(pinned);
    expect(pinned.className.split(' ')).toEqual(
        expect.arrayContaining(['shrink-0', 'border-t', 'border-edge', 'px-4', 'py-3']),
    );
    expect(pinned).toContainElement(screen.getByRole('button', { name: 'Save' }));
    return { dialog, body, pinned };
}

describe('BottomSheet footer slot', () => {
    it('renders the footer after the scrolling body, outside it', () => {
        renderSheet({ footer });
        expectPinnedFooter();
    });

    it('renders no footer element when the prop is absent', () => {
        renderSheet();
        expect(screen.queryByTestId('bottom-sheet-footer')).not.toBeInTheDocument();
        expect(screen.getByRole('dialog').lastElementChild).toBe(scrollBody());
    });

    it('keeps the footer pinned when the sheet opens expanded', () => {
        renderSheet({ footer, initiallyExpanded: true });
        const { dialog } = expectPinnedFooter();
        expect(dialog.style.maxHeight).toBe('950px');
    });

    it('keeps the footer pinned when maxHeight caps the sheet', () => {
        renderSheet({ footer, maxHeight: '40vh' });
        const { dialog } = expectPinnedFooter();
        expect(dialog.style.maxHeight).toBe('400px');
    });
});

describe('BottomSheet footer matches the Modal footer', () => {
    /** A Modal / BottomSheet pair passes the same actions to both (design-system.md), so the bars must lay out alike. */
    it('uses the same footer bar layout as Modal', () => {
        const actions = <><button type="button">Cancel</button><button type="button">Save</button></>;
        render(<Modal isOpen onClose={() => {}} title="Reschedule" footer={actions}><p>Modal body</p></Modal>);
        renderSheet({ footer: actions });
        const modalBar = screen.getByTestId('modal-footer').className.split(' ').sort();
        const sheetBar = screen.getByTestId('bottom-sheet-footer').className.split(' ').sort();
        expect(sheetBar, 'BottomSheet footer bar must use the Modal footer layout classes').toEqual(modalBar);
        expect(sheetBar).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'items-center', 'justify-end', 'gap-2']));
    });
});
