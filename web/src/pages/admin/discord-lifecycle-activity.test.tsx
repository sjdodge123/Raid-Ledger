/**
 * ROK-1428 (L7) — W4 activity chips + Recreate only on suppressed rows, pin
 * PATCH (+ 400 inline), W6 Run confirm as Modal ≥1024px / BottomSheet below.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { buildLifecycleActivity, buildReconcileResult } from '../../test/mocks/channel-lifecycle-handlers';
import { ActivitySection } from './discord-lifecycle-activity';
import { RunConfirm } from './discord-lifecycle-run';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('../../hooks/use-media-query', () => ({ useMediaQuery: () => media.desktop }));

const BINDINGS = 'http://localhost:3000/admin/discord/bindings';
const AUTO = { id: '00000000-0000-4000-8000-000000000001', channelId: '5', lifecycleState: 'active' as const, autoManaged: true, pinned: false };
const ROWS = [
    buildLifecycleActivity({ gameId: 1, gameName: 'Alpha', action: 'create', reason: '2 items',
        signals: [{ kind: 'event', itemCount: 2, lastActivityAt: '2026-10-19T00:00:00.000Z' }], itemCount: 2 }),
    buildLifecycleActivity({ gameId: 2, gameName: 'Bravo', action: 'unarchive', binding: { ...AUTO, lifecycleState: 'archived' } }),
    buildLifecycleActivity({ gameId: 3, gameName: 'Charlie', action: 'archive', binding: AUTO }),
    buildLifecycleActivity({ gameId: 4, gameName: 'Delta', action: 'none', binding: { ...AUTO, id: '00000000-0000-4000-8000-000000000004', autoManaged: false } }),
    buildLifecycleActivity({ gameId: 5, gameName: 'Echo', action: 'create', suppressed: true, reason: 'Deleted by hand' }),
];

function rowFor(name: string): HTMLElement {
    const row = screen.getByText(name).closest('[data-testid="lifecycle-activity-row"]');
    if (!(row instanceof HTMLElement)) throw new Error(`no row for ${name}`);
    return row;
}

beforeEach(() => { media.desktop = true; });

describe('ActivitySection (ROK-1433 W4)', () => {
    it.each([true, false])('renders each action chip, Recreate only on the suppressed row (desktop=%s)', (desktop) => {
        media.desktop = desktop;
        renderWithProviders(<ActivitySection items={ROWS} windowDays={30} />);
        expect(screen.getByTestId(desktop ? 'lifecycle-activity-table' : 'lifecycle-activity-cards')).toBeInTheDocument();
        expect(within(rowFor('Alpha')).getByText('Create')).toHaveAttribute('data-tone', 'success');
        expect(within(rowFor('Alpha')).getByText('Events 2')).toBeInTheDocument();
        expect(within(rowFor('Bravo')).getByText('Unarchive')).toHaveAttribute('data-tone', 'success');
        expect(within(rowFor('Charlie')).getByText('Archive')).toHaveAttribute('data-tone', 'warning');
        expect(within(rowFor('Delta')).getByText('No change')).toHaveAttribute('data-tone', 'neutral');
        expect(within(rowFor('Delta')).getByText('manual')).toBeInTheDocument();
        expect(within(rowFor('Delta')).queryByRole('button', { name: 'Pin' })).not.toBeInTheDocument();
        expect(within(rowFor('Echo')).getByText('Suppressed')).toHaveAttribute('data-tone', 'neutral');
        expect(screen.getAllByRole('button', { name: 'Recreate' })).toHaveLength(1);
        expect(within(rowFor('Echo')).getByRole('button', { name: 'Recreate' })).toBeInTheDocument();
    });

    it('shows the empty state', () => {
        renderWithProviders(<ActivitySection items={[]} windowDays={30} />);
        expect(screen.getByText('No game activity in the last 30 days.')).toBeInTheDocument();
    });

    it('Pin PATCHes {pinned:true}; a 400 shows inline', async () => {
        const bodies: unknown[] = [];
        server.use(http.patch(`${BINDINGS}/:id`, async ({ request }) => {
            bodies.push(await request.json());
            return HttpResponse.json({ message: 'Only Raid Ledger-managed channels can be pinned' }, { status: 400 });
        }));
        renderWithProviders(<ActivitySection items={ROWS} windowDays={30} />);
        await userEvent.click(within(rowFor('Charlie')).getByRole('button', { name: 'Pin' }));
        await waitFor(() => expect(bodies).toEqual([{ pinned: true }]));
        expect(await within(rowFor('Charlie')).findByText('Only Raid Ledger-managed channels can be pinned')).toBeInTheDocument();
    });

    it('Recreate DELETEs the suppression', async () => {
        const urls: string[] = [];
        server.use(http.delete('http://localhost:3000/admin/discord/lifecycle/suppressions/:gameId', ({ request }) => {
            urls.push(new URL(request.url).pathname);
            return new HttpResponse(null, { status: 204 });
        }));
        renderWithProviders(<ActivitySection items={ROWS} windowDays={30} />);
        await userEvent.click(within(rowFor('Echo')).getByRole('button', { name: 'Recreate' }));
        await waitFor(() => expect(urls).toEqual(['/admin/discord/lifecycle/suppressions/5']));
    });
});

describe('RunConfirm (ROK-1433 W6)', () => {
    it.each([[true, 'modal'], [false, 'sheet']])('desktop=%s renders a %s', (desktop) => {
        media.desktop = desktop;
        renderWithProviders(<RunConfirm plan={buildReconcileResult({ created: 2, archived: 1 })} running={false} onConfirm={vi.fn()} onClose={vi.fn()} />);
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Create 2, archive 1, unarchive 0 channels in Discord?')).toBeInTheDocument();
        if (desktop) expect(dialog).toHaveAttribute('aria-labelledby');
        else expect(dialog).toHaveAttribute('aria-label', 'Run channel automation');
    });
});
