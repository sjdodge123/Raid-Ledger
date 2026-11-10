/**
 * ROK-2143: the admin WoW Forever quest import panel — idle, running (polled),
 * finished, failed, and the server's 409 / 403 message on Re-import.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    buildQuestImportReport,
    buildSucceededReport,
    foreverQuestImportGetHandler,
    foreverQuestImportPostHandler,
} from '../../../test/mocks/forever-quest-import-handlers';
import { FOREVER_QUEST_IMPORT_POLL_MS, questImportRefetchInterval } from '../hooks/use-forever-quest-import';
import { ForeverQuestImportPanel } from './forever-quest-import-panel';

const RUNNING = buildQuestImportReport({ status: 'running', runId: 'run-2', startedAt: '2026-11-09T11:00:00.000Z' });

function button(): HTMLElement {
    return screen.getByRole('button', { name: /re-import quests|importing quests/i });
}

describe('ForeverQuestImportPanel status', () => {
    it('idle: says the import has not run and offers Re-import', async () => {
        server.use(foreverQuestImportGetHandler(buildQuestImportReport()));
        renderWithProviders(<ForeverQuestImportPanel />);
        expect(await screen.findByText('The quest import has not run yet.')).toBeInTheDocument();
        expect(button()).toHaveAccessibleName('Re-import quests');
        expect(button()).not.toHaveAttribute('aria-busy', 'true');
        expect(screen.queryByTestId('forever-quest-import-counts')).not.toBeInTheDocument();
    });

    it('running: shows the run as in progress and the button busy', async () => {
        server.use(foreverQuestImportGetHandler(RUNNING));
        renderWithProviders(<ForeverQuestImportPanel />);
        const state = await screen.findByText('running');
        expect(state.closest('p')).toHaveTextContent(/Import\s+running\s+since/);
        expect(button()).toHaveAttribute('aria-busy', 'true');
    });

    it('succeeded: shows the finish time, counts and no mismatches', async () => {
        server.use(foreverQuestImportGetHandler(buildSucceededReport()));
        renderWithProviders(<ForeverQuestImportPanel />);
        expect(await screen.findByText('succeeded')).toBeInTheDocument();
        expect(screen.getByText(/Last run/)).toBeInTheDocument();
        expect(screen.getByTestId('forever-quest-import-counts')).toHaveTextContent(
            '19 dungeons · 120 quests · 14 prerequisites · 134 saved · 0 errors',
        );
        expect(screen.queryByText(/did not match/)).not.toBeInTheDocument();
    });

    it('failed: shows the error count and each mismatched area', async () => {
        server.use(foreverQuestImportGetHandler(buildSucceededReport({
            status: 'failed',
            errors: ['quest 1486: HTTP 429', 'run aborted'],
            mismatchedAreas: [{ instanceId: 43, dungeon: 'Wailing Caverns', areaId: 718, actualName: 'The Barrens' }],
        })));
        renderWithProviders(<ForeverQuestImportPanel />);
        expect(await screen.findByText('failed')).toBeInTheDocument();
        expect(screen.getByTestId('forever-quest-import-counts')).toHaveTextContent('2 errors');
        expect(screen.getByText(/did not match/)).toBeInTheDocument();
        expect(screen.getByText('Wailing Caverns (area 718: The Barrens)')).toBeInTheDocument();
    });

});

describe('ForeverQuestImportPanel error list (L6)', () => {
    it('lists every error line and the evidence for a skipped dungeon', async () => {
        server.use(foreverQuestImportGetHandler(buildSucceededReport({
            errors: ['quest/1101: HTTP 404', 'quest/2040: unparseable response', 'quest/area/1337: HTTP 404'],
            mismatchedAreas: [{
                instanceId: 234, dungeon: 'Razorfen Kraul', areaId: 491, actualName: null,
                nameMatches: [{ id: 4000, name: 'Razorfen Kraul' }],
                sampleQuest: { questId: 1101, httpStatus: 200, areaId: 17, areaName: 'The Barrens' },
            }],
        })));
        renderWithProviders(<ForeverQuestImportPanel />);
        const list = await screen.findByTestId('forever-quest-import-errors');
        expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
            'quest/1101: HTTP 404', 'quest/2040: unparseable response', 'quest/area/1337: HTTP 404',
        ]);
        expect(screen.getByTestId('forever-quest-import-counts')).toHaveTextContent('3 errors');
        expect(screen.getByText('Razorfen Kraul (area 491: not found)', { exact: false })).toBeInTheDocument();
        expect(screen.getByText('Blizzard lists "Razorfen Kraul" as area 4000')).toBeInTheDocument();
        expect(screen.getByText('its quest 1101 is filed under The Barrens (area 17)')).toBeInTheDocument();
    });

    it('caps a long error list at 5 rows behind Show all', async () => {
        const errors = Array.from({ length: 7 }, (_, i) => `quest/${100 + i}: HTTP 404`);
        server.use(foreverQuestImportGetHandler(buildSucceededReport({ errors })));
        renderWithProviders(<ForeverQuestImportPanel />);
        const list = await screen.findByTestId('forever-quest-import-errors');
        expect(within(list).getAllByRole('listitem')).toHaveLength(5);
        await userEvent.click(within(list).getByRole('button', { name: 'Show all 7' }));
        expect(within(list).getAllByRole('listitem')).toHaveLength(7);
    });

    it('shows no error list when the run had no errors', async () => {
        server.use(foreverQuestImportGetHandler(buildSucceededReport()));
        renderWithProviders(<ForeverQuestImportPanel />);
        await screen.findByText('succeeded');
        expect(screen.queryByTestId('forever-quest-import-errors')).not.toBeInTheDocument();
    });
});

describe('ForeverQuestImportPanel Re-import', () => {
    it('Re-import: 202 shows running, then polls until the run finishes', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            server.use(
                foreverQuestImportGetHandler(buildQuestImportReport(), RUNNING, buildSucceededReport()),
                foreverQuestImportPostHandler(RUNNING),
            );
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            renderWithProviders(<ForeverQuestImportPanel />);
            await screen.findByText('The quest import has not run yet.');
            await user.click(button());
            expect(await screen.findByText('running')).toBeInTheDocument();
            await act(async () => {
                await vi.advanceTimersByTimeAsync(FOREVER_QUEST_IMPORT_POLL_MS * 2);
            });
            expect(await screen.findByText('succeeded')).toBeInTheDocument();
            await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy', 'true'));
        } finally {
            vi.useRealTimers();
        }
    });

    it.each([
        [409, 'A Forever quest import is already running'],
        [403, 'The WoW Forever quest import is turned off'],
    ] as const)('Re-import: a %i shows the server message', async (status, message) => {
        server.use(
            foreverQuestImportGetHandler(buildQuestImportReport()),
            foreverQuestImportPostHandler({ status, message }),
        );
        renderWithProviders(<ForeverQuestImportPanel />);
        await screen.findByText('The quest import has not run yet.');
        await userEvent.click(button());
        expect(await screen.findByRole('alert')).toHaveTextContent(message);
        expect(screen.getByText('The quest import has not run yet.')).toBeInTheDocument();
    });
});

describe('ForeverQuestImportPanel automatic runs (ROK-2162)', () => {
    it.each([
        ['manual', 'manual'],
        ['auto-empty', 'automatic (first import)'],
        ['weekly', 'automatic (weekly)'],
    ] as const)('names the %s trigger next to the last run time', async (trigger, label) => {
        const report = buildSucceededReport({ trigger, lastAutoRunAt: null });
        server.use(foreverQuestImportGetHandler(report));
        renderWithProviders(<ForeverQuestImportPanel />);
        const line = (await screen.findByText('succeeded')).closest('p');
        const time = new Date(report.finishedAt ?? '').toLocaleString().replace(/\s+/g, ' ');
        expect(line).toHaveTextContent(`Last run ${time} · ${label} · succeeded`);
        expect(line).not.toHaveTextContent('auto-empty');
    });

    it('shows the last automatic run time', async () => {
        const at = '2026-11-04T06:30:00.000Z';
        server.use(foreverQuestImportGetHandler(buildSucceededReport({ trigger: 'manual', lastAutoRunAt: at })));
        renderWithProviders(<ForeverQuestImportPanel />);
        expect(await screen.findByTestId('forever-quest-import-last-auto')).toHaveTextContent(
            `Last automatic run: ${new Date(at).toLocaleString().replace(/\s+/g, ' ')}`,
        );
    });

    it('an old report without trigger or last automatic run renders cleanly', async () => {
        server.use(foreverQuestImportGetHandler(buildSucceededReport()));
        renderWithProviders(<ForeverQuestImportPanel />);
        const line = (await screen.findByText('succeeded')).closest('p');
        expect(line).toHaveTextContent(/^Last run .+ · succeeded$/);
        expect(line).not.toHaveTextContent(/manual|automatic/);
        expect(screen.getByTestId('forever-quest-import-last-auto')).toHaveTextContent('Last automatic run: never');
        expect(document.body).not.toHaveTextContent(/undefined|Invalid Date/);
    });

    it('says the import runs by itself, with Re-import as the manual override', async () => {
        server.use(foreverQuestImportGetHandler(buildQuestImportReport()));
        renderWithProviders(<ForeverQuestImportPanel />);
        expect(await screen.findByText(
            'Imports automatically when there is no quest data yet, then every week. Re-import quests runs it now.',
        )).toBeInTheDocument();
        expect(screen.queryByTestId('forever-quest-import-last-auto')).not.toBeInTheDocument();
    });
});

describe('questImportRefetchInterval', () => {
    it('polls only while the report is running', () => {
        expect(questImportRefetchInterval(RUNNING)).toBe(FOREVER_QUEST_IMPORT_POLL_MS);
        expect(questImportRefetchInterval(buildSucceededReport())).toBe(false);
        expect(questImportRefetchInterval(buildQuestImportReport())).toBe(false);
        expect(questImportRefetchInterval(undefined)).toBe(false);
    });
});
