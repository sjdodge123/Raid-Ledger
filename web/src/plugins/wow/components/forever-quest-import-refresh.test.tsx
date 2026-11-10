/**
 * ROK-2162 (Codex P2): an AUTOMATIC quest import the server starts must reach
 * the admin panel — after a Blizzard keys save, after a Forever settings save,
 * and by itself while the panel is open. A Re-import that races it (409) gets
 * plain copy and re-reads the report.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX, ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../../test/render-helpers';
import {
    buildQuestImportReport, buildSucceededReport, foreverQuestImportGetHandler, foreverQuestImportPostHandler,
} from '../../../test/mocks/forever-quest-import-handlers';
import { useBlizzardSettings } from '../../../hooks/admin/use-blizzard-settings';
import { useForeverConfig } from '../hooks/use-forever-config';
import { FOREVER_QUEST_IMPORT_IDLE_POLL_MS, FOREVER_QUEST_IMPORT_KEY } from '../hooks/use-forever-quest-import';
import { ForeverQuestImportPanel, QUEST_IMPORT_ALREADY_RUNNING, QUEST_IMPORT_RUNNING_CODE } from './forever-quest-import-panel';

const IDLE = buildQuestImportReport();
const RUNNING = buildQuestImportReport({ status: 'running', runId: 'auto-1', startedAt: '2026-11-09T11:00:00.000Z', trigger: 'auto-empty' });
const CONFIG = { namespacePrefix: 'classicforever', namespacePrefixIsDefault: true, armoryImportEnabled: true };

function button(): HTMLElement {
    return screen.getByRole('button', { name: /re-import quests|importing quests/i });
}

/** The panel and a settings hook on ONE QueryClient, so a save's invalidation reaches the panel. */
async function panelWith<T>(useHook: () => T): Promise<{ current: T }> {
    const queryClient = createTestQueryClient();
    renderWithProviders(<ForeverQuestImportPanel />, { queryClient });
    await screen.findByText('The quest import has not run yet.');
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return renderHook(useHook, { wrapper }).result;
}

describe('quest import status refresh after a settings save (ROK-2162)', () => {
    it('a Blizzard API keys save re-reads the import status', async () => {
        server.use(
            foreverQuestImportGetHandler(IDLE, RUNNING),
            http.put('*/admin/settings/blizzard', () => HttpResponse.json({ success: true, message: 'Saved' })),
        );
        const hook = await panelWith(useBlizzardSettings);
        await act(async () => { await hook.current.updateBlizzard.mutateAsync({ clientId: 'id', clientSecret: 'secret' }); });
        expect((await screen.findByText('running')).closest('p')).toHaveTextContent(/Import\s+running\s+since/);
    });

    it('a WoW Forever settings save re-reads the import status', async () => {
        server.use(
            foreverQuestImportGetHandler(IDLE, RUNNING),
            http.get('*/admin/plugins/blizzard/forever', () => HttpResponse.json(CONFIG)),
            http.put('*/admin/plugins/blizzard/forever', () => HttpResponse.json(CONFIG)),
        );
        const hook = await panelWith(useForeverConfig);
        await act(async () => {
            await hook.current.update.mutateAsync({ namespacePrefix: 'classicforever', armoryImportEnabled: true });
        });
        expect((await screen.findByText('running')).closest('p')).toHaveTextContent(/Import\s+running\s+since/);
    });
});

describe('a run the server starts by itself (ROK-2162)', () => {
    it('shows up while the panel is open, with no user action', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            server.use(foreverQuestImportGetHandler(IDLE, RUNNING));
            renderWithProviders(<ForeverQuestImportPanel />);
            await screen.findByText('The quest import has not run yet.');
            await act(async () => { await vi.advanceTimersByTimeAsync(FOREVER_QUEST_IMPORT_IDLE_POLL_MS); });
            expect(await screen.findByText('running')).toBeInTheDocument();
            expect(button()).toBeDisabled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('Re-import is disabled while a run is in progress', async () => {
        server.use(foreverQuestImportGetHandler(RUNNING));
        renderWithProviders(<ForeverQuestImportPanel />);
        await screen.findByText('running');
        expect(button()).toBeDisabled();
    });

    it('a Re-import that races the run (409) says so plainly and re-reads the report', async () => {
        server.use(
            foreverQuestImportGetHandler(IDLE, RUNNING),
            foreverQuestImportPostHandler({ status: 409, message: 'A Forever quest import is already running', code: QUEST_IMPORT_RUNNING_CODE }),
        );
        renderWithProviders(<ForeverQuestImportPanel />);
        await screen.findByText('The quest import has not run yet.');
        await userEvent.click(button());
        expect(await screen.findByText(QUEST_IMPORT_ALREADY_RUNNING)).toHaveAttribute('role', 'alert');
        expect((await screen.findByText('running')).closest('p')).toHaveTextContent(/Import\s+running\s+since/);
        expect(button()).toBeDisabled();
    });

    it('the 409 alert clears once the run it raced has finished', async () => {
        server.use(
            foreverQuestImportGetHandler(IDLE, RUNNING, buildSucceededReport()),
            foreverQuestImportPostHandler({ status: 409, message: 'A Forever quest import is already running', code: QUEST_IMPORT_RUNNING_CODE }),
        );
        const queryClient = createTestQueryClient();
        renderWithProviders(<ForeverQuestImportPanel />, { queryClient });
        await screen.findByText('The quest import has not run yet.');
        await userEvent.click(button());
        await screen.findByText('running');
        expect(screen.getByRole('alert')).toHaveTextContent(QUEST_IMPORT_ALREADY_RUNNING);
        await act(async () => { await queryClient.invalidateQueries({ queryKey: [...FOREVER_QUEST_IMPORT_KEY] }); });
        await screen.findByText('succeeded');
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });
});
