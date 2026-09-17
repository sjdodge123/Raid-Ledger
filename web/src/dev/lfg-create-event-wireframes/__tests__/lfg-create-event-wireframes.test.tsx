/**
 * ROK-1573/1572 wireframe smoke coverage.
 *
 * Dev-only DEMO_MODE route, so the bar is behavioural: every variant tab
 * mounts the real LFG page composition without throwing, the variant's
 * distinguishing copy is present, and the gate redirects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { LfgCreateEventWireframesPage } from '../LfgCreateEventWireframesPage';

const mockStatus = vi.fn();
vi.mock('../../../hooks/use-system-status', () => ({
    useSystemStatus: () => mockStatus(),
}));

beforeEach(() => {
    mockStatus.mockReturnValue({ data: { demoMode: true }, isLoading: false });
});

const VARIANTS: Array<{ id: string; expectText: string }> = [
    { id: 'L1a', expectText: 'Everyone looking gets a Discord card and a vote on times.' },
    { id: 'L1b', expectText: 'Create event · Tonight 8 PM' },
    { id: 'L2', expectText: 'No shared window yet — the grid needs more hours in it' },
    { id: 'L3', expectText: 'You land on the poll next.' },
    { id: 'L4', expectText: 'Open the event ›' },
    { id: 'L5', expectText: 'its 4 members are signed up when you create it.' },
];

describe('LfgCreateEventWireframesPage', () => {
    it.each(VARIANTS)('renders the $id variant tab', ({ id, expectText }) => {
        renderWithProviders(<LfgCreateEventWireframesPage />);
        fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${id}\\b`) }));
        expect(screen.getAllByText(expectText, { exact: false }).length).toBeGreaterThan(0);
    });

    it('mounts the real LFG page panels on the page variants', () => {
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
