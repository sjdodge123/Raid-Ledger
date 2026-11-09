/**
 * ROK-2143: the admin WoW Forever quest import panel — idle, running (polled),
 * finished, failed, and the server's 409 / 403 message on Re-import.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
        expect(await screen.findByText('running')).toBeInTheDocument();
        expect(screen.getByText(/Import\s+running\s+since/)).toBeInTheDocument();
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

describe('ForeverQuestImportPanel Re-import', () => {
    it('Re-import: 202 shows running, then polls until the run finishes', async () => {
        server.use(
            foreverQuestImportGetHandler(buildQuestImportReport(), RUNNING, buildSucceededReport()),
            foreverQuestImportPostHandler(RUNNING),
        );
        renderWithProviders(<ForeverQuestImportPanel />);
        await screen.findByText('The quest import has not run yet.');
        await userEvent.click(button());
        expect(await screen.findByText('running')).toBeInTheDocument();
        expect(await screen.findByText('succeeded', {}, { timeout: FOREVER_QUEST_IMPORT_POLL_MS * 3 })).toBeInTheDocument();
        await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy', 'true'));
    }, 15_000);

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

describe('questImportRefetchInterval', () => {
    it('polls only while the report is running', () => {
        expect(questImportRefetchInterval(RUNNING)).toBe(FOREVER_QUEST_IMPORT_POLL_MS);
        expect(questImportRefetchInterval(buildSucceededReport())).toBe(false);
        expect(questImportRefetchInterval(buildQuestImportReport())).toBe(false);
        expect(questImportRefetchInterval(undefined)).toBe(false);
    });
});
