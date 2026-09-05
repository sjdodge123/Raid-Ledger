/**
 * ROK-1464 AC3 — the "When everyone's free" panel.
 *
 * The panel is the D4 entry point: `Start poll` must hand back the WINDOW so
 * the caller can seed the poll's first slot with `window.start`. Losing that
 * argument would silently downgrade the flow to a bare `Find a time`.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import {
    createMockOverlapResponse,
    createMockOverlapWindow,
} from '../../test/lfg-factories';
import { LfgOverlapPanel } from './LfgOverlapPanel';

const WED_7PM = new Date(2026, 8, 2, 19).toISOString();
const WED_10PM = new Date(2026, 8, 2, 22).toISOString();

describe('LfgOverlapPanel', () => {
    it('explains that overlap needs two people before it can exist', () => {
        renderWithProviders(
            <LfgOverlapPanel
                overlap={createMockOverlapResponse({
                    memberCount: 1,
                    windows: [],
                })}
                onStartPoll={vi.fn()}
            />,
        );

        expect(
            screen.getByText('Overlap appears once two people are in'),
        ).toBeInTheDocument();
        expect(screen.queryAllByTestId('lfg-overlap-day')).toHaveLength(0);
    });

    it('paints a full-roster day as a hit and leaves untouched days empty', () => {
        renderWithProviders(
            <LfgOverlapPanel
                overlap={createMockOverlapResponse({
                    memberCount: 2,
                    windows: [
                        createMockOverlapWindow({
                            start: WED_7PM,
                            end: WED_10PM,
                            availableCount: 2,
                            totalCount: 2,
                        }),
                    ],
                })}
                onStartPoll={vi.fn()}
            />,
        );

        const days = screen.getAllByTestId('lfg-overlap-day');
        expect(days).toHaveLength(7);
        expect(days[2]).toHaveAttribute('data-status', 'hit');
        expect(days[0]).toHaveAttribute('data-status', 'none');
    });
});

describe('LfgOverlapPanel — window rows', () => {
    it('lists at most two ranked windows and starts a poll on the exact one clicked', async () => {
        const user = userEvent.setup();
        const onStartPoll = vi.fn();
        const second = createMockOverlapWindow({
            start: new Date(2026, 8, 3, 20).toISOString(),
            end: new Date(2026, 8, 3, 22).toISOString(),
            availableCount: 2,
            totalCount: 3,
        });
        renderWithProviders(
            <LfgOverlapPanel
                overlap={createMockOverlapResponse({
                    memberCount: 2,
                    windows: [
                        createMockOverlapWindow({
                            start: WED_7PM,
                            end: WED_10PM,
                        }),
                        second,
                        createMockOverlapWindow({
                            start: new Date(2026, 8, 4, 20).toISOString(),
                            end: new Date(2026, 8, 4, 22).toISOString(),
                        }),
                    ],
                })}
                onStartPoll={onStartPoll}
            />,
        );

        expect(
            screen.getByText('Wed 7–10 PM · 2 of 2 free'),
        ).toBeInTheDocument();
        expect(
            screen.getByText('Thu 8–10 PM · 2 of 3 free'),
        ).toBeInTheDocument();
        const rows = screen.getAllByRole('button', { name: 'Start poll' });
        expect(rows).toHaveLength(2);

        await user.click(rows[1]);
        expect(onStartPoll).toHaveBeenCalledWith(second);
    });

    it('says so when a two-person roster still has no shared window', () => {
        renderWithProviders(
            <LfgOverlapPanel
                overlap={createMockOverlapResponse({
                    memberCount: 3,
                    windows: [],
                })}
                onStartPoll={vi.fn()}
            />,
        );

        expect(screen.getByText(/no shared window yet/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Start poll' })).toBeNull();
    });
});
