/**
 * ROK-1428 web review fixes — switch-off while offline, the pre-save Archived
 * note, per-section errors, number reset after a failed PATCH, the Run-now
 * gating + confirm-path errors, and the loading / error states.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import {
    BOT_SETTINGS_API, CATEGORIES_API, LIFECYCLE_API, buildLifecycleSettings, buildReconcileResult,
} from '../../test/mocks/channel-lifecycle-handlers';
import { DiscordLifecyclePage } from './discord-lifecycle-page';

const SWITCH = { name: 'Create and archive game channels automatically' };
const EMPTY = /No game activity in the last/;

function useBot(connected: boolean): void {
    server.use(http.get(BOT_SETTINGS_API, () => HttpResponse.json({ configured: true, connected, enabled: true })));
}

function refusePatch(message: string): unknown[] {
    const bodies: unknown[] = [];
    server.use(http.patch(`${LIFECYCLE_API}/settings`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ message }, { status: 400 });
    }));
    return bodies;
}

function reconcileReturns(overrides: Parameters<typeof buildReconcileResult>[0]): string[] {
    const runs: string[] = [];
    server.use(http.post(`${LIFECYCLE_API}/reconcile`, ({ request }) => {
        const dryRun = new URL(request.url).searchParams.get('dryRun') ?? '';
        runs.push(dryRun);
        return HttpResponse.json(buildReconcileResult({ ...overrides, dryRun: dryRun === 'true' }));
    }));
    return runs;
}

beforeEach(() => { useBot(true); });

describe('Automation switch (review MAJOR 1 + MINOR note)', () => {
    it('can still be switched OFF while the bot is offline', async () => {
        useBot(false);
        server.use(http.get(`${LIFECYCLE_API}/settings`, () => HttpResponse.json(buildLifecycleSettings({ enabled: true, archiveCategoryId: '9' }))));
        const bodies: unknown[] = [];
        server.use(http.patch(`${LIFECYCLE_API}/settings`, async ({ request }) => {
            bodies.push(await request.json());
            return HttpResponse.json(buildLifecycleSettings({ enabled: false }));
        }));
        renderWithProviders(<DiscordLifecyclePage />);
        const toggle = await screen.findByRole('switch', SWITCH);
        await waitFor(() => expect(toggle).toBeEnabled());
        await userEvent.click(toggle);
        await waitFor(() => expect(bodies).toEqual([{ enabled: false }]));
    });

    it('shows the find-or-create note BEFORE saving, and drops it after a 400', async () => {
        refusePatch('Choose or allow an Archived category before enabling');
        renderWithProviders(<DiscordLifecyclePage />);
        expect(await screen.findByTestId('lifecycle-archive-note')).toBeInTheDocument();
        const toggle = screen.getByRole('switch', SWITCH);
        await waitFor(() => expect(toggle).toBeEnabled());
        await userEvent.click(toggle);
        expect(await screen.findByText('Choose or allow an Archived category before enabling')).toBeInTheDocument();
        expect(screen.queryByTestId('lifecycle-archive-note')).not.toBeInTheDocument();
    });
});

describe('Per-section save errors + number reset (review MINOR)', () => {
    it('a category 400 shows under Categories, not under Automation', async () => {
        server.use(http.get(CATEGORIES_API, () => HttpResponse.json([{ id: '7', name: 'Voice' }])));
        refusePatch('Not a category');
        renderWithProviders(<DiscordLifecyclePage />);
        const select = await screen.findByLabelText('Archived channels go in');
        expect(await screen.findAllByRole('option', { name: 'Voice' })).toHaveLength(2);
        await userEvent.selectOptions(select, '7');
        const categories = screen.getByRole('region', { name: 'Categories' });
        expect(await within(categories).findByText('Not a category')).toBeInTheDocument();
        expect(within(screen.getByRole('region', { name: 'Automation' })).queryByText('Not a category')).not.toBeInTheDocument();
    });

    it('a failed threshold PATCH resets the box to the saved value and says why', async () => {
        refusePatch('Server said no');
        renderWithProviders(<DiscordLifecyclePage />);
        const days = await screen.findByLabelText('Archive after N days without activity');
        await userEvent.clear(days);
        await userEvent.type(days, '45');
        await userEvent.tab();
        const thresholds = screen.getByRole('region', { name: 'Thresholds' });
        expect(await within(thresholds).findByText('Server said no')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByLabelText('Archive after N days without activity')).toHaveValue(30));
    });
});

describe('Run now gating + errors (review MAJOR 2 + MINOR)', () => {
    it('skips the confirm when the dry run reports a stop reason', async () => {
        const runs = reconcileReturns({ created: 2, stoppedReason: 'offline' });
        renderWithProviders(<DiscordLifecyclePage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Run now' }));
        expect(await screen.findByText('Stopped: the Discord bot is offline.')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(runs).toEqual(['true']);
    });

    it('skips the confirm when the dry run plans zero changes', async () => {
        const runs = reconcileReturns({});
        renderWithProviders(<DiscordLifecyclePage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Run now' }));
        expect(await screen.findByText(/Nothing to change/)).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(runs).toEqual(['true']);
    });

    it('a 409 on the confirm path renders inside the dialog, which stays open', async () => {
        server.use(http.post(`${LIFECYCLE_API}/reconcile`, ({ request }) => {
            if (new URL(request.url).searchParams.get('dryRun') === 'true') return HttpResponse.json(buildReconcileResult({ created: 1 }));
            return HttpResponse.json({ message: 'A reconcile is already running' }, { status: 409 });
        }));
        renderWithProviders(<DiscordLifecyclePage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Run now' }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Run in Discord' }));
        expect(await within(dialog).findByText('A reconcile is already running')).toBeInTheDocument();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
});

describe('Loading + error states (review MAJOR 3)', () => {
    it('shows loading — never the empty copy — while the activity loads', async () => {
        server.use(http.get(`${LIFECYCLE_API}/activity`, async () => { await delay('infinite'); return HttpResponse.json({}); }));
        renderWithProviders(<DiscordLifecyclePage />);
        expect(await screen.findByText('Loading the preview…')).toBeInTheDocument();
        expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
    });

    it('a failed activity / categories / suppressions load says so, with a retry', async () => {
        const fail = (): Response => HttpResponse.json({ message: 'boom' }, { status: 500 });
        server.use(http.get(`${LIFECYCLE_API}/activity`, fail), http.get(CATEGORIES_API, fail), http.get(`${LIFECYCLE_API}/suppressions`, fail));
        renderWithProviders(<DiscordLifecyclePage />);
        expect(await screen.findByText('Couldn’t load the preview.')).toBeInTheDocument();
        expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
        expect(await screen.findAllByText('Couldn’t load the Discord categories.')).not.toHaveLength(0);
        expect(await screen.findByText('Couldn’t load the suppressed games.')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThanOrEqual(2);
    });
});
