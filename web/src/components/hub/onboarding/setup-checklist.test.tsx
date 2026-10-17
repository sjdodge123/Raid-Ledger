/**
 * ROK-1830 S5b — the hub Overview setup checklist: who sees it, what it marks
 * done, and how it goes away.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildDiscordMirrorDto, GuildProfile, HubOnboardingStateDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { HubSetupChecklist } from './setup-checklist';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const ONBOARDING = 'http://localhost:3000/guilds/onboarding';
const PROFILE = 'http://localhost:3000/plugins/wow/guilds/7/profile';
const DISCORD = 'http://localhost:3000/plugins/wow/guilds/7/discord';
const EMPTY_PROFILE: GuildProfile = { guildId: 7, gmPost: null, rules: [], links: [] };
const UNSET: GuildDiscordMirrorDto = { state: 'unset' };

function serve(profile: GuildProfile, discord: GuildDiscordMirrorDto, state: HubOnboardingStateDto = { dismissed: [] }): void {
    server.use(
        http.get(ONBOARDING, () => HttpResponse.json(state)),
        http.get(PROFILE, () => HttpResponse.json(profile)),
        http.get(DISCORD, () => HttpResponse.json(discord)),
    );
}

describe('HubSetupChecklist', () => {
    it('lists every step with its progress, and marks only what exists as done', async () => {
        serve({ ...EMPTY_PROFILE, rules: [{ title: 'Be on time', body: 'Invites at 19:45.' }] }, UNSET);
        renderWithProviders(<HubSetupChecklist guildId={7} canEdit modsConfigured={false} />);
        const list = await screen.findByTestId('setup-checklist');
        expect(screen.getByTestId('setup-checklist-progress')).toHaveTextContent('1 of 5 done');
        expect(within(list).getByTestId('setup-step-rules')).toHaveAttribute('data-done', 'true');
        expect(within(list).getByTestId('setup-step-leader-post')).toHaveAttribute('data-done', 'false');
        // A done step offers no action — only the open ones do.
        expect(within(list).queryByTestId('setup-step-action-rules')).not.toBeInTheDocument();
        expect(within(list).getByTestId('setup-step-action-links')).toHaveAttribute('href', '#resources');
    });

    it('the publish step is listed with its reason instead of an action', async () => {
        serve(EMPTY_PROFILE, UNSET);
        renderWithProviders(<HubSetupChecklist guildId={7} canEdit modsConfigured={false} />);
        const blocked = await screen.findByTestId('setup-step-blocked-publish');
        expect(blocked).toHaveTextContent('hidden-by-default hub is coming');
    });

    it('a viewer who cannot edit never sees it', async () => {
        serve(EMPTY_PROFILE, UNSET);
        const { container } = renderWithProviders(<HubSetupChecklist guildId={7} canEdit={false} modsConfigured={false} />);
        await waitFor(() => expect(container).toBeEmptyDOMElement());
    });

    it('every actionable step done ⇒ the checklist removes itself', async () => {
        serve(
            {
                guildId: 7,
                gmPost: { body: 'Raid night is Tuesday.', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: 'Jake' },
                rules: [{ title: 'Be on time', body: 'Invites at 19:45.' }],
                links: [{ title: 'Links', links: [{ label: 'Discord', url: 'https://discord.gg/x' }] }],
            },
            { state: 'disconnected', channelId: '123' },
        );
        const { container } = renderWithProviders(<HubSetupChecklist guildId={7} canEdit modsConfigured />);
        await waitFor(() => expect(container).toBeEmptyDOMElement());
    });

    it('dismissing it takes it off this hub', async () => {
        serve(EMPTY_PROFILE, UNSET);
        server.use(http.post(`${ONBOARDING}/hub-setup-checklist/dismiss`, () => HttpResponse.json({
            dismissed: [{ key: 'hub-setup-checklist', guildId: 7, dismissedAt: '2026-10-02T00:00:00.000Z' }],
        } satisfies HubOnboardingStateDto)));
        renderWithProviders(<HubSetupChecklist guildId={7} canEdit modsConfigured={false} />);
        await userEvent.click(await screen.findByTestId('setup-checklist-dismiss'));
        await waitFor(() => expect(screen.queryByTestId('setup-checklist')).not.toBeInTheDocument());
    });

    it('a dismissal stored for this hub keeps it hidden from the start', async () => {
        serve(EMPTY_PROFILE, UNSET, { dismissed: [{ key: 'hub-setup-checklist', guildId: 7, dismissedAt: '2026-10-01T00:00:00.000Z' }] });
        const { container } = renderWithProviders(<HubSetupChecklist guildId={7} canEdit modsConfigured={false} />);
        await waitFor(() => expect(container).toBeEmptyDOMElement());
    });
});
