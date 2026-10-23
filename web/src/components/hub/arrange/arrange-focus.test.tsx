/**
 * ROK-1918 — focus stays with the moved row (spec §2.4, design-system §4.28):
 * Move up / Move down keep focus on the same arrow of the moved row, or the
 * opposite arrow once the row reaches an end; a drag drop focuses the dropped
 * row; Hide / Show keeps focus on the toggled button.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HubLayoutEntry } from '../layout/resolve-hub-layout';
import { renderWithProviders } from '../../../test/render-helpers';
import HubArrangeMode from './hub-arrange-mode';
import { DRAG_MQ } from './use-row-drag';

function entry(id: string, title: string): HubLayoutEntry {
    return { id, title, defaultOrder: 10, span: 1, audience: 'everyone', defaultOn: true };
}

const ARRANGED = [entry('a', 'Alpha'), entry('b', 'Bravo'), entry('c', 'Charlie')].map((e) => ({ entry: e, on: true }));

const realMatchMedia = window.matchMedia;

function stubDrag(matches: boolean): void {
    window.matchMedia = ((query: string) => ({
        ...realMatchMedia(query),
        matches: query === DRAG_MQ ? matches : realMatchMedia(query).matches,
    })) as typeof window.matchMedia;
}

function renderMode(): void {
    renderWithProviders(<HubArrangeMode guildId={7} kind="guild" arranged={ARRANGED} available={[]} prefs={null} onExit={() => {}} />);
}

const btn = (name: string): HTMLElement => screen.getByRole('button', { name });

afterEach(() => { window.matchMedia = realMatchMedia; });

describe('arrange list — focus management', () => {
    // Mid-list, React's commit phase already restores focus to the moved node
    // (restoreSelection); these two guard that the explicit refocus keeps it.
    it('Move down keeps focus on the moved row\'s Move down arrow', async () => {
        stubDrag(false);
        const user = userEvent.setup();
        renderMode();
        await user.click(btn('Move Alpha down'));
        expect(btn('Move Alpha down')).toHaveFocus();
    });

    it('Move up keeps focus on the moved row\'s Move up arrow', async () => {
        stubDrag(false);
        const user = userEvent.setup();
        renderMode();
        await user.click(btn('Move Charlie up'));
        expect(btn('Move Charlie up')).toHaveFocus();
    });

    it('moving a row to the end moves focus to its (still enabled) Move up arrow', async () => {
        stubDrag(false);
        const user = userEvent.setup();
        renderMode();
        await user.click(btn('Move Bravo down'));
        expect(btn('Move Bravo down')).toBeDisabled();
        expect(btn('Move Bravo up')).toHaveFocus();
    });

    it('moving a row to the start moves focus to its (still enabled) Move down arrow', async () => {
        stubDrag(false);
        const user = userEvent.setup();
        renderMode();
        await user.click(btn('Move Bravo up'));
        expect(btn('Move Bravo up')).toBeDisabled();
        expect(btn('Move Bravo down')).toHaveFocus();
    });

    it('a drag drop focuses the dropped row', () => {
        stubDrag(true);
        renderMode();
        const dt = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: 'none', dropEffect: 'none' };
        const target = screen.getByTestId('arrange-row-c');
        fireEvent.dragStart(screen.getAllByTestId('arrange-drag-handle')[0] ?? document.body, { dataTransfer: dt });
        fireEvent.dragOver(target, { dataTransfer: dt });
        fireEvent.drop(target, { dataTransfer: dt });
        expect(screen.getByTestId('arrange-row-a')).toHaveFocus();
    });

    it('Hide / Show keeps focus on the toggled button', async () => {
        stubDrag(false);
        const user = userEvent.setup();
        renderMode();
        await user.click(btn('Hide Bravo'));
        expect(btn('Show Bravo')).toHaveFocus();
        await user.click(btn('Show Bravo'));
        expect(btn('Hide Bravo')).toHaveFocus();
    });
});
