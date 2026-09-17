/**
 * ROK-1464 AC3 — the "When everyone's free" panel.
 *
 * ROK-1573: each row's `Lock in this event` must hand back the WINDOW so the
 * page confirms and creates the event for exactly that range.
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
                onLockIn={vi.fn()}
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
                onLockIn={vi.fn()}
            />,
        );

        const days = screen.getAllByTestId('lfg-overlap-day');
        expect(days).toHaveLength(7);
        expect(days[2]).toHaveAttribute('data-status', 'hit');
        expect(days[0]).toHaveAttribute('data-status', 'none');
    });
});

describe('LfgOverlapPanel — window rows', () => {
    it('lists at most two ranked windows and locks in the exact one clicked', async () => {
        const user = userEvent.setup();
        const onLockIn = vi.fn();
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
                onLockIn={onLockIn}
            />,
        );

        expect(
            screen.getByText('Wed 7–10 PM · 2 of 2 free'),
        ).toBeInTheDocument();
        expect(
            screen.getByText('Thu 8–10 PM · 2 of 3 free'),
        ).toBeInTheDocument();
        const rows = screen.getAllByTestId('lfg-lockin');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveTextContent('Lock in this event');

        await user.click(rows[1]);
        expect(onLockIn).toHaveBeenCalledWith(second);
    });

    it('says so when a two-person roster still has no shared window', () => {
        renderWithProviders(
            <LfgOverlapPanel
                overlap={createMockOverlapResponse({
                    memberCount: 3,
                    windows: [],
                })}
                onLockIn={vi.fn()}
            />,
        );

        expect(screen.getByText(/no shared window yet/i)).toBeInTheDocument();
        expect(screen.queryByTestId('lfg-lockin')).toBeNull();
    });
});

describe('LfgOverlapPanel — intent gate', () => {
    it('disables Lock in with the hint while the viewer holds no intent', async () => {
        const user = userEvent.setup();
        const onLockIn = vi.fn();
        renderWithProviders(
            <LfgOverlapPanel
                overlap={createMockOverlapResponse({ memberCount: 2 })}
                onLockIn={onLockIn}
                disabledHint="+1 first"
            />,
        );

        const row = screen.getByTestId('lfg-lockin');
        expect(row).toBeDisabled();
        expect(row).toHaveAttribute('title', '+1 first');
        await user.click(row);
        expect(onLockIn).not.toHaveBeenCalled();
    });
});
