/** ROK-2056 AC5 / AC6 / AC9 — the shared "install the Companion" line. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { server } from '../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../test/render-helpers';
import { COMPANION_DEVICES_KEY } from '../../hooks/use-companion-devices';
import { buildCompanionDevice, companionDevicesHandler } from '../../test/mocks/companion-devices-handlers';
import { CompanionInstallLink } from './companion-install-link';

const flag = vi.hoisted(() => ({ available: true }));
vi.mock('../../lib/companion-install', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../lib/companion-install')>()),
    companionDownloadAvailable: () => flag.available,
}));

beforeEach(() => {
    flag.available = true;
});

describe('CompanionInstallLink', () => {
    it('shows the line, linking to the install card, when the viewer has no active device', async () => {
        server.use(companionDevicesHandler([buildCompanionDevice({ state: 'revoked', revokedAt: '2026-10-20T00:00:00.000Z' })]));
        renderWithProviders(<CompanionInstallLink lead="Saves can upload by themselves —" />);
        const line = await screen.findByTestId('companion-install-link');
        expect(line).toHaveTextContent('Saves can upload by themselves — install the Companion.');
        expect(screen.getByRole('link', { name: 'install the Companion' }))
            .toHaveAttribute('href', '/profile/integrations#companion');
    });

    it('hides the line once the viewer has an active device', async () => {
        server.use(companionDevicesHandler([buildCompanionDevice()]));
        const queryClient = createTestQueryClient();
        renderWithProviders(<CompanionInstallLink lead="Lead —" />, { queryClient });
        await waitFor(() => expect(queryClient.getQueryState(COMPANION_DEVICES_KEY)?.status).toBe('success'));
        expect(screen.queryByTestId('companion-install-link')).toBeNull();
    });

    it('renders nothing and fetches nothing while no public download exists', async () => {
        flag.available = false;
        server.use(companionDevicesHandler([]));
        const queryClient = createTestQueryClient();
        renderWithProviders(<CompanionInstallLink lead="Lead —" />, { queryClient });
        expect(screen.queryByTestId('companion-install-link')).toBeNull();
        expect(queryClient.getQueryState(COMPANION_DEVICES_KEY)).toBeUndefined();
    });
});
