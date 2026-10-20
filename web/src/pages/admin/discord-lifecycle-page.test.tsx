/**
 * ROK-1428 (L7) — `/admin/settings/discord/lifecycle`: W1 enable note + PATCH
 * body, W2 bot offline, W3 threshold bounds, W5 Preview → Run now, and the
 * 409 "already running" refusal, all against MSW.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import {
    BOT_SETTINGS_API, LIFECYCLE_API, buildLifecycleSettings, buildReconcileResult,
} from '../../test/mocks/channel-lifecycle-handlers';
import { DiscordLifecyclePage } from './discord-lifecycle-page';

interface Call { method: string; url: string; body: unknown }
let calls: Call[] = [];

function useBot(connected: boolean): void {
    server.use(http.get(BOT_SETTINGS_API, () => HttpResponse.json({ configured: true, connected, enabled: true })));
}

function trackPatch(): void {
    server.use(http.patch(`${LIFECYCLE_API}/settings`, async ({ request }) => {
        const body: unknown = await request.json();
        calls.push({ method: 'PATCH', url: request.url, body });
        return HttpResponse.json(buildLifecycleSettings({ enabled: true }));
    }));
}

beforeEach(() => { calls = []; useBot(true); });

describe('DiscordLifecyclePage (ROK-1433)', () => {
    it('W1: enabling with no archive category notes the find-or-create and PATCHes {enabled:true}', async () => {
        trackPatch();
        renderWithProviders(<DiscordLifecyclePage />);
        const toggle = await screen.findByRole('switch', { name: 'Create and archive game channels automatically' });
        await waitFor(() => expect(toggle).toBeEnabled());
        await userEvent.click(toggle);
        expect(await screen.findByText(/will create an ‘Archived’ category/)).toBeInTheDocument();
        await waitFor(() => expect(calls).toEqual([expect.objectContaining({ body: { enabled: true } })]));
    });

    it('W1: a refused enable shows the server message inline', async () => {
        server.use(http.patch(`${LIFECYCLE_API}/settings`, () =>
            HttpResponse.json({ message: 'Choose or allow an Archived category before enabling' }, { status: 400 })));
        renderWithProviders(<DiscordLifecyclePage />);
        const toggle = await screen.findByRole('switch', { name: 'Create and archive game channels automatically' });
        await waitFor(() => expect(toggle).toBeEnabled());
        await userEvent.click(toggle);
        expect(await screen.findByText('Choose or allow an Archived category before enabling')).toBeInTheDocument();
    });

    it('W2: the switch is disabled with a hint while the bot is offline', async () => {
        useBot(false);
        renderWithProviders(<DiscordLifecyclePage />);
        expect(await screen.findByText('Connect the Discord bot to turn this on.')).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: 'Create and archive game channels automatically' })).toBeDisabled();
    });

});

describe('DiscordLifecyclePage thresholds + run (ROK-1433)', () => {
    it('W3: out-of-range thresholds show field errors and send nothing', async () => {
        trackPatch();
        renderWithProviders(<DiscordLifecyclePage />);
        const days = await screen.findByLabelText('Archive after N days without activity');
        await userEvent.clear(days);
        await userEvent.type(days, '1');
        await userEvent.tab();
        expect(await screen.findByText('Enter a whole number from 7 to 180.')).toBeInTheDocument();
        await userEvent.clear(days);
        await userEvent.type(days, '200');
        await userEvent.tab();
        expect(screen.getByText('Enter a whole number from 7 to 180.')).toBeInTheDocument();
        const create = screen.getByLabelText('Create a channel after N activities');
        await userEvent.clear(create);
        await userEvent.type(create, '1');
        await userEvent.tab();
        expect(await screen.findByText('Enter a whole number from 2 to 10.')).toBeInTheDocument();
        expect(calls).toEqual([]);
    });

    it('W3: a valid threshold PATCHes just that key', async () => {
        trackPatch();
        renderWithProviders(<DiscordLifecyclePage />);
        const days = await screen.findByLabelText('Archive after N days without activity');
        await userEvent.clear(days);
        await userEvent.type(days, '45');
        await userEvent.tab();
        await waitFor(() => expect(calls).toEqual([expect.objectContaining({ body: { recentActivityDays: 45 } })]));
    });

    it('W5: Run now previews, confirms with the counts, then runs for real', async () => {
        const runs: string[] = [];
        server.use(http.post(`${LIFECYCLE_API}/reconcile`, ({ request }) => {
            const dryRun = new URL(request.url).searchParams.get('dryRun') ?? '';
            runs.push(dryRun);
            return HttpResponse.json(buildReconcileResult({ dryRun: dryRun === 'true', created: 2, archived: 1 }));
        }));
        renderWithProviders(<DiscordLifecyclePage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Run now' }));
        expect(await screen.findByText('Create 2, archive 1, unarchive 0 channels in Discord?')).toBeInTheDocument();
        expect(runs).toEqual(['true']);
        await userEvent.click(screen.getByRole('button', { name: 'Run in Discord' }));
        await waitFor(() => expect(runs).toEqual(['true', 'false']));
        expect(await screen.findByText(/Created 2 · Unarchived 0 · Archived 1/)).toBeInTheDocument();
    });

    it('W5: a 409 says a reconcile is already running', async () => {
        server.use(http.post(`${LIFECYCLE_API}/reconcile`, () =>
            HttpResponse.json({ message: 'A reconcile is already running' }, { status: 409 })));
        renderWithProviders(<DiscordLifecyclePage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Preview changes' }));
        expect(await screen.findByText('A reconcile is already running')).toBeInTheDocument();
    });

    it('shows the last run error banner', async () => {
        server.use(http.get(`${LIFECYCLE_API}/settings`, () => HttpResponse.json(buildLifecycleSettings({
            lastRunAt: '2026-10-20T09:00:00.000Z', lastRunError: 'Missing Manage Channels permission',
        }))));
        renderWithProviders(<DiscordLifecyclePage />);
        expect(await screen.findByText('Missing Manage Channels permission')).toBeInTheDocument();
    });
});
