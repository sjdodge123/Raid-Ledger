/**
 * ROK-1918 L6 — native drag on the arrange list: handle only at a desktop
 * fine-pointer media query, dragstart → dragover → drop reorders the rows,
 * shows the 2px drop line, and announces "<Widget> moved to position N of M.".
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { HubLayoutEntry } from '../layout/resolve-hub-layout';
import { renderWithProviders } from '../../../test/render-helpers';
import HubArrangeMode, { DRAG_MQ } from './hub-arrange-mode';

function entry(id: string, title: string): HubLayoutEntry {
    return { id, title, defaultOrder: 10, span: 1, audience: 'everyone', defaultOn: true };
}

const ARRANGED = [entry('gm-post', 'Latest post'), entry('schedule', 'Schedule'), entry('events', 'Events'), entry('module:uptime', 'Uptime')]
    .map((e) => ({ entry: e, on: true }));

const realMatchMedia = window.matchMedia;

function stubMedia(dragMatches: boolean): void {
    window.matchMedia = ((query: string) => ({
        ...realMatchMedia(query),
        matches: query === DRAG_MQ ? dragMatches : realMatchMedia(query).matches,
    })) as typeof window.matchMedia;
}

function dataTransfer(): Pick<DataTransfer, 'setData' | 'setDragImage' | 'effectAllowed' | 'dropEffect'> {
    return { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: 'none', dropEffect: 'none' };
}

function renderMode(): void {
    renderWithProviders(<HubArrangeMode guildId={7} arranged={ARRANGED} available={[]} prefs={null} onExit={() => {}} />);
}

const order = (): string[] => within(screen.getByRole('list', { name: 'Overview widgets, in order' }))
    .getAllByRole('listitem').map((li) => li.getAttribute('data-testid') ?? '');

afterEach(() => { window.matchMedia = realMatchMedia; });

describe('arrange list — native drag (spec §2.4, Q6)', () => {
    it('renders no drag handle on touch / below 1024px', () => {
        stubMedia(false);
        renderMode();
        expect(screen.queryAllByTestId('arrange-drag-handle')).toHaveLength(0);
    });

    it('dragging Latest post onto Events moves it to position 3 and announces it', () => {
        stubMedia(true);
        renderMode();
        const handles = screen.getAllByTestId('arrange-drag-handle');
        expect(handles).toHaveLength(4);
        const dt = dataTransfer();
        const target = screen.getByTestId('arrange-row-events');
        fireEvent.dragStart(handles[0] ?? document.body, { dataTransfer: dt });
        expect(dt.setData).toHaveBeenCalledWith('text/plain', '0');
        fireEvent.dragOver(target, { dataTransfer: dt });
        expect(within(target).getByTestId('arrange-drop-line').getAttribute('data-edge')).toBe('after');
        fireEvent.drop(target, { dataTransfer: dt });
        expect(order()).toEqual(['arrange-row-schedule', 'arrange-row-events', 'arrange-row-gm-post', 'arrange-row-module:uptime']);
        expect(screen.getByTestId('arrange-live').textContent).toBe('Latest post moved to position 3 of 4.');
        expect(screen.queryAllByTestId('arrange-drop-line')).toHaveLength(0);
    });

    it('dragging upward shows the line above the target and lands before it', () => {
        stubMedia(true);
        renderMode();
        const dt = dataTransfer();
        const target = screen.getByTestId('arrange-row-schedule');
        fireEvent.dragStart(screen.getAllByTestId('arrange-drag-handle')[3] ?? document.body, { dataTransfer: dt });
        fireEvent.dragOver(target, { dataTransfer: dt });
        expect(within(target).getByTestId('arrange-drop-line').getAttribute('data-edge')).toBe('before');
        fireEvent.drop(target, { dataTransfer: dt });
        expect(order()).toEqual(['arrange-row-gm-post', 'arrange-row-module:uptime', 'arrange-row-schedule', 'arrange-row-events']);
        expect(screen.getByTestId('arrange-live').textContent).toBe('Uptime moved to position 2 of 4.');
    });

    it('a drop with no drag in progress (e.g. a file from outside) changes nothing', () => {
        stubMedia(true);
        renderMode();
        fireEvent.drop(screen.getByTestId('arrange-row-events'), { dataTransfer: dataTransfer() });
        expect(order()[0]).toBe('arrange-row-gm-post');
        expect(screen.getByTestId('arrange-live').textContent).toBe('');
    });
});
