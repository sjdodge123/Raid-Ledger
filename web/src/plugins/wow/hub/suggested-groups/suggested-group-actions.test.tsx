/**
 * Phone confirm before Schedule / Poll (operator 2026-11-19): below
 * `DESKTOP_MQ` a tap opens a confirm sheet and nothing happens until
 * Continue; from 1024px Schedule is the plain link and Poll acts at once.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { JSX } from 'react';
import { PAGE } from '../dungeon-planner/dungeon-planner-tab.fixtures';
import { SuggestedGroupActions } from './suggested-group-actions';
import { scheduleHref } from './suggested-groups-links';
import { group } from './suggested-groups.fixtures';

const media = vi.hoisted(() => ({ desktop: false }));
vi.mock('../../../../hooks/use-media-query', () => ({ useMediaQuery: () => media.desktop }));

const G = group(101, 'Shadowfang Keep');
const SCHEDULE_NAME = 'Schedule Shadowfang Keep, invites 3 of 5';
const POLL_NAME = 'Poll Shadowfang Keep group';

function Where(): JSX.Element {
    const loc = useLocation();
    return <output data-testid="where">{`${loc.pathname}${loc.search}`}</output>;
}

function renderActions(onPoll = vi.fn()): ReturnType<typeof vi.fn> {
    render(
        <MemoryRouter initialEntries={['/hubs/7']}>
            <Routes>
                <Route path="/hubs/7" element={<SuggestedGroupActions group={G} page={PAGE} canAct onPoll={onPoll} />} />
                <Route path="*" element={null} />
            </Routes>
            <Where />
        </MemoryRouter>,
    );
    return onPoll;
}

const where = (): string | null => screen.getByTestId('where').textContent;

beforeEach(() => { media.desktop = false; });

describe('SuggestedGroupActions on a phone', () => {
    it('(a) Schedule opens the confirm and stays put; Continue goes to the pre-filled Create Event', async () => {
        renderActions();
        await userEvent.click(screen.getByRole('button', { name: SCHEDULE_NAME }));
        const sheet = screen.getByRole('dialog', { name: 'Schedule Shadowfang Keep?' });
        const body = within(sheet).getByTestId('suggested-group-confirm');
        expect(within(body).getAllByRole('listitem').map((li) => li.textContent))
            .toEqual(['Tankard', 'Mendy', 'Stabby', 'Frosty', 'Pyro']);
        expect(within(body).getByText('Invites 3 of 5')).toHaveClass('text-sm', 'text-muted');
        expect(where(), 'a tap on Schedule must not navigate before Continue').toBe('/hubs/7');
        await userEvent.click(screen.getByTestId('suggested-group-confirm-continue'));
        expect(where()).toBe(scheduleHref(G, PAGE));
        expect(screen.queryByTestId('suggested-group-confirm')).toBeNull();
    });

    it('(b) Cancel closes the confirm and does nothing else', async () => {
        const onPoll = renderActions();
        await userEvent.click(screen.getByRole('button', { name: SCHEDULE_NAME }));
        await userEvent.click(screen.getByTestId('suggested-group-confirm-cancel'));
        expect(screen.queryByTestId('suggested-group-confirm')).toBeNull();
        expect(where()).toBe('/hubs/7');
        expect(onPoll).not.toHaveBeenCalled();
    });

    it('(c) Poll opens the confirm without polling; Continue calls onPoll once with the group', async () => {
        const onPoll = renderActions();
        await userEvent.click(screen.getByRole('button', { name: POLL_NAME }));
        expect(screen.getByRole('dialog', { name: 'Start a poll for Shadowfang Keep?' })).toBeInTheDocument();
        expect(onPoll, 'a tap on Poll must not open the poll before Continue').not.toHaveBeenCalled();
        await userEvent.click(screen.getByTestId('suggested-group-confirm-continue'));
        expect(onPoll).toHaveBeenCalledTimes(1);
        expect(onPoll).toHaveBeenCalledWith(G);
        expect(screen.queryByTestId('suggested-group-confirm')).toBeNull();
        expect(where()).toBe('/hubs/7');
    });
});

describe('SuggestedGroupActions on desktop', () => {
    it('(d) Schedule is the Create Event link and Poll calls onPoll directly, with no confirm', async () => {
        media.desktop = true;
        const onPoll = renderActions();
        expect(screen.getByRole('link', { name: SCHEDULE_NAME })).toHaveAttribute('href', scheduleHref(G, PAGE));
        await userEvent.click(screen.getByRole('button', { name: POLL_NAME }));
        expect(onPoll).toHaveBeenCalledTimes(1);
        expect(onPoll).toHaveBeenCalledWith(G);
        expect(screen.queryByTestId('suggested-group-confirm')).toBeNull();
    });
});
