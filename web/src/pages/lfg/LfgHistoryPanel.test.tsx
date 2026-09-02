/**
 * ROK-1464 AC4 — "Played here before".
 *
 * The attendance wording is load-bearing: `attendedCount` and `signedUpCount`
 * are NOT interchangeable (ROK-1463 DTO note), so a row that only has
 * sign-ups must not claim anybody actually turned up.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockHistoryEntry } from '../../test/lfg-factories';
import { LfgHistoryPanel } from './LfgHistoryPanel';

/** Local wall clock, so the rendered `d MMM` is timezone-independent. */
const AUG_21_7PM = new Date(2026, 7, 21, 19).toISOString();

describe('LfgHistoryPanel', () => {
    it('reports confirmed attendance with a human duration', () => {
        renderWithProviders(
            <LfgHistoryPanel
                history={{
                    gameId: 7,
                    entries: [
                        createMockHistoryEntry({
                            title: 'Friday deep dive',
                            startedAt: AUG_21_7PM,
                            attendedCount: 3,
                            signedUpCount: 4,
                            durationMinutes: 160,
                        }),
                    ],
                }}
            />,
        );

        expect(screen.getByText('Friday deep dive')).toBeInTheDocument();
        expect(
            screen.getByText('21 Aug · 3 attended · 2h 40m'),
        ).toBeInTheDocument();
    });

    it('falls back to sign-ups when no attendance was ever recorded', () => {
        renderWithProviders(
            <LfgHistoryPanel
                history={{
                    gameId: 7,
                    entries: [
                        createMockHistoryEntry({
                            startedAt: AUG_21_7PM,
                            attendedCount: 0,
                            signedUpCount: 5,
                            // Never-recorded case: the list IS the signed-up
                            // roster (an empty list would mean no-shows).
                            participantIds: [1, 2, 3, 4, 5],
                            durationMinutes: 45,
                        }),
                    ],
                }}
            />,
        );

        expect(
            screen.getByText('21 Aug · 5 signed up · 45m'),
        ).toBeInTheDocument();
        expect(screen.queryByText(/attended/)).toBeNull();
    });
});

describe('LfgHistoryPanel — formatting and empty state', () => {
    it('drops the minutes on a whole-hour session', () => {
        renderWithProviders(
            <LfgHistoryPanel
                history={{
                    gameId: 7,
                    entries: [
                        createMockHistoryEntry({
                            startedAt: AUG_21_7PM,
                            durationMinutes: 120,
                        }),
                    ],
                }}
            />,
        );

        expect(screen.getByText(/· 2h$/)).toBeInTheDocument();
    });

    it('separates a recorded no-show from a session that never took attendance', () => {
        renderWithProviders(
            <LfgHistoryPanel
                history={{
                    gameId: 7,
                    entries: [
                        createMockHistoryEntry({
                            eventId: 1,
                            title: 'Nobody turned up',
                            startedAt: AUG_21_7PM,
                            attendedCount: 0,
                            signedUpCount: 5,
                            // Attendance WAS taken — the empty list is the answer.
                            participantIds: [],
                            durationMinutes: 60,
                        }),
                        createMockHistoryEntry({
                            eventId: 2,
                            title: 'Never recorded',
                            startedAt: AUG_21_7PM,
                            attendedCount: 0,
                            signedUpCount: 5,
                            // No attendance ever recorded — the roster fallback.
                            participantIds: [1, 2, 3, 4, 5],
                            durationMinutes: 60,
                        }),
                    ],
                }}
            />,
        );

        expect(
            screen.getByText('21 Aug · nobody attended · 1h'),
        ).toBeInTheDocument();
        expect(
            screen.getByText('21 Aug · 5 signed up · 1h'),
        ).toBeInTheDocument();
    });

    it('marks a Quick Play session apart from a scheduled event', () => {
        renderWithProviders(
            <LfgHistoryPanel
                history={{
                    gameId: 7,
                    entries: [
                        createMockHistoryEntry({
                            isAdHoc: true,
                            startedAt: AUG_21_7PM,
                        }),
                    ],
                }}
            />,
        );

        expect(screen.getByText('Quick Play')).toBeInTheDocument();
    });

    it('says nothing has been played here yet when the list is empty', () => {
        renderWithProviders(
            <LfgHistoryPanel history={{ gameId: 7, entries: [] }} />,
        );

        expect(
            screen.getByText('No sessions logged for this game yet'),
        ).toBeInTheDocument();
    });
});
