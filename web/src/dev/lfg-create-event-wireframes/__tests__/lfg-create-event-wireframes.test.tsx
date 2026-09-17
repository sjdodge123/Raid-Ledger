/**
 * ROK-1573/1572/1571 wireframe smoke coverage.
 *
 * Dev-only DEMO_MODE route, so the bar is behavioural: every H tab mounts the
 * LFG page in the poll-hero language without throwing, shows its distinguishing
 * state, keeps exactly ONE scheduling-poll button, and the gate redirects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { LfgCreateEventWireframesPage } from '../LfgCreateEventWireframesPage';

const mockStatus = vi.fn();
vi.mock('../../../hooks/use-system-status', () => ({
    useSystemStatus: () => mockStatus(),
}));

beforeEach(() => {
    mockStatus.mockReturnValue({ data: { demoMode: true }, isLoading: false });
});

/** Open the page on one H tab. */
function openTab(id: string): void {
    renderWithProviders(<LfgCreateEventWireframesPage />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${id}\\b`) }));
}

const TABS: Array<{ id: string; testId: string; expectText: string }> = [
    { id: 'H1', testId: 'wf-lfg-hero', expectText: 'FULL GROUP' },
    { id: 'H2', testId: 'wf-manage-body', expectText: 'Withdraw' },
    { id: 'H3', testId: 'wf-lockin-confirm', expectText: 'get signed up' },
    { id: 'H4', testId: 'wf-poll-confirm', expectText: 'Start poll' },
    { id: 'H5', testId: 'wf-participants-list', expectText: 'This week' },
    { id: 'H6', testId: 'wf-lfg-hero', expectText: 'EVENT SET' },
    { id: 'H7', testId: 'wf-lfg-hero', expectText: 'LOOKING FOR MEMBERS' },
];

describe('LfgCreateEventWireframesPage', () => {
    it.each(TABS)('renders the $id tab', ({ id, testId, expectText }) => {
        openTab(id);
        const region = screen.getByTestId(testId);
        expect(within(region).getAllByText(expectText, { exact: false }).length).toBeGreaterThan(0);
    });

    it('H1 has exactly one scheduling-poll button and a Lock in per time', () => {
        openTab('H1');
        expect(screen.getAllByRole('button', { name: 'Start a scheduling poll' })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: /^Lock in this event/ })).toHaveLength(2);
        expect(screen.getByText('Everyone looking gets a Discord card and a vote on times.')).toBeInTheDocument();
        expect(screen.queryByTestId('lfg-full-group-prompt')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    });

    it('H1 participants chip opens the participants list', () => {
        openTab('H1');
        fireEvent.click(screen.getByRole('button', { name: 'Participants, 4' }));
        expect(screen.getByTestId('wf-participants-list')).toBeInTheDocument();
    });

    it('H3 Lock in moves the hero to the event (H6)', () => {
        openTab('H3');
        fireEvent.click(within(screen.getByTestId('wf-lockin-confirm')).getByRole('button', { name: 'Lock in' }));
        expect(within(screen.getByTestId('wf-lfg-hero')).getByText('EVENT SET')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Open the event' })).toBeInTheDocument();
    });

    it('H7 shows the overlap empty state with the poll still primary', () => {
        openTab('H7');
        expect(screen.getByText(/No shared window yet/)).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Start a scheduling poll' })).toHaveLength(1);
    });

    it('mounts the real LFG page panels', () => {
        renderWithProviders(<LfgCreateEventWireframesPage />);
        expect(screen.getByTestId('lfg-header')).toBeInTheDocument();
        expect(screen.getByTestId('lfg-history-panel')).toBeInTheDocument();
        expect(screen.getByTestId('lfg-suggestions-panel')).toBeInTheDocument();
    });

    it('renders an iframe at phone width when the toggle is on', () => {
        renderWithProviders(<LfgCreateEventWireframesPage />);
        fireEvent.click(screen.getByRole('button', { name: /phone width/i }));
        expect(screen.getByTestId('wf-phone-frame')).toHaveAttribute('width', '390');
    });

    it('redirects when DEMO_MODE is off', () => {
        mockStatus.mockReturnValue({ data: { demoMode: false }, isLoading: false });
        renderWithProviders(<LfgCreateEventWireframesPage />);
        expect(screen.queryByTestId('lfg-header')).not.toBeInTheDocument();
    });
});
