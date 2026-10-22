/**
 * ROK-1893 P1 (ruling §8b) — the Leader's off / suggest / auto setting in the
 * hub settings sheet: Leader or staff only, shown only when the API sent
 * `guild.autoMembership`, and a change PATCHes `/hubs/:id/auto-membership`.
 */
import type { JSX, ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useQuery } from '@tanstack/react-query';
import type { GuildPage, GuildRaidsDto, HubAutoMembershipMode, LadderRole } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { buildCommunityPage } from '../../../test/factories/community-hub';
import { renderWithProviders } from '../../../test/render-helpers';
import type { HubCtx } from '../../../plugins/hub-module';
import { CommunitySettingsSections } from './community-settings';

let userRole = 'member';
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: userRole }, isAuthenticated: true }),
}));

const API = 'http://localhost:3000';
const bodies: unknown[] = [];

function WithCtx({ page, children }: { page: GuildPage; children: (ctx: HubCtx) => ReactNode }): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['test-raids'], queryFn: () => new Promise<GuildRaidsDto>(() => undefined), enabled: false });
    return <>{children({ page, raids })}</>;
}

function pageWith(role: LadderRole, mode: HubAutoMembershipMode | undefined): GuildPage {
    const page = buildCommunityPage({ role });
    return { ...page, guild: { ...page.guild, ...(mode === undefined ? {} : { autoMembership: mode }) } };
}

function render(page: GuildPage): void {
    renderWithProviders(<WithCtx page={page}>{(ctx) => <CommunitySettingsSections {...ctx} />}</WithCtx>);
}

beforeEach(() => {
    userRole = 'member';
    bodies.length = 0;
    server.use(
        http.get(`${API}/hubs/:id/bans`, () => HttpResponse.json({ items: [] })),
        http.patch(`${API}/hubs/:id/auto-membership`, async ({ request, params }) => {
            bodies.push({ hubId: params['id'], body: await request.json() });
            return HttpResponse.json({ mode: 'auto' });
        }),
    );
});

describe('community auto-membership section', () => {
    it('shows the Leader the current mode', () => {
        render(pageWith('leader', 'suggest'));
        const group = screen.getByRole('radiogroup', { name: 'When someone signs up for a hub event' });
        expect(group).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /Suggest/ })).toBeChecked();
        expect(screen.getByRole('radio', { name: /Off/ })).not.toBeChecked();
    });

    it('PATCHes the new mode when the Leader picks Auto', async () => {
        render(pageWith('leader', 'suggest'));
        await userEvent.click(screen.getByRole('radio', { name: /Auto/ }));
        await waitFor(() => expect(bodies).toEqual([{ hubId: '41', body: { mode: 'auto' } }]));
    });

    it('is hidden from an officer even when the field is present', () => {
        render(pageWith('officer', 'off'));
        expect(screen.queryByTestId('community-settings-auto-membership')).not.toBeInTheDocument();
    });

    it('is hidden when the API sent no autoMembership', () => {
        render(pageWith('leader', undefined));
        expect(screen.queryByTestId('community-settings-auto-membership')).not.toBeInTheDocument();
    });

    it('shows staff the setting on a hub they do not lead', () => {
        userRole = 'admin';
        render(pageWith('member', 'off'));
        expect(screen.getByRole('radio', { name: /Off/ })).toBeChecked();
    });
});
