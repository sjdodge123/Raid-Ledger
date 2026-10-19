/**
 * ROK-1831 fix r1b — "Hide this hub" reads `guild.hidden` (sent to staff
 * only) and a click PATCHes the opposite value.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildPage } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { HideHubRow } from './hide-hub-row';

vi.mock('../../../hooks/use-auth', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../hooks/use-auth')>();
    return { ...actual, useAuth: () => ({ user: { id: 1, role: 'admin' }, isAuthenticated: true }) };
});

const BASE = 'http://localhost:3000/guilds/7';

function page(hidden: boolean | undefined): GuildPage {
    return {
        guild: {
            id: 7, gameId: 1, kind: 'wow_guild', name: 'Iron Vanguard', region: 'us', realmSlug: null, realmName: null,
            faction: null, memberCount: 1, lastSnapshotAt: null, ...(hidden === undefined ? {} : { hidden }),
        },
        importedBy: null,
        viewer: { role: 'leader', canEdit: true, canManageEditors: true },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

/** Render the row and record every PATCH body. */
function renderRow(hidden: boolean | undefined): unknown[] {
    const bodies: unknown[] = [];
    server.use(http.patch(`${BASE}/hidden`, async ({ request }) => {
        const body = await request.json();
        bodies.push(body);
        return HttpResponse.json(body);
    }));
    renderWithProviders(<HideHubRow page={page(hidden)} />);
    return bodies;
}

describe('HideHubRow (ROK-1831)', () => {
    it.each([
        [true, 'true', false],
        [false, 'false', true],
        [undefined, 'false', true],
    ] as const)('hidden=%s renders aria-checked=%s and a click sends hidden=%s', async (hidden, shown, sent) => {
        const bodies = renderRow(hidden);
        const sw = screen.getByTestId('guild-settings-hide-hub');
        expect(sw).toHaveAttribute('aria-checked', shown);
        await userEvent.click(sw);
        await waitFor(() => expect(bodies).toEqual([{ hidden: sent }]));
    });
});
