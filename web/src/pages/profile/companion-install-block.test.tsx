/** ROK-2056 — the "Raid Ledger Companion" card: install block by linked state and download flag. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { COMPANION_DOWNLOAD_URL, COMPANION_UNSIGNED_NOTE, type CompanionDevice } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { CompanionDevicesSection } from './companion-devices-section';

const flag = vi.hoisted(() => ({ on: true }));
vi.mock('../../lib/companion-install', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../lib/companion-install')>()),
    companionDownloadAvailable: () => flag.on,
}));

const LIST = 'http://localhost:3000/companion/v1/devices';

function device(over: Partial<CompanionDevice> = {}): CompanionDevice {
    return {
        id: 1, name: 'Gaming-PC', os: 'windows', osVersion: '11', appVersion: '0.1.0', tokenHint: 'ab12',
        createdAt: '2026-10-12T12:00:00.000Z', lastUsedAt: null, lastUsedNetwork: null,
        revokedAt: null, state: 'active', ...over,
    };
}

function mockDevices(rows: CompanionDevice[]): void {
    server.use(http.get(LIST, () => HttpResponse.json({ data: rows })));
}

const scrollSpy = vi.fn();
beforeEach(() => { flag.on = true; scrollSpy.mockReset(); Element.prototype.scrollIntoView = scrollSpy; });
afterEach(() => { server.resetHandlers(); });

describe('Companion card — not linked (ROK-2056 AC1)', () => {
    it('shows heading + Beta, an open install block, then Your computers', async () => {
        mockDevices([]);
        renderWithProviders(<CompanionDevicesSection />);
        const install = await screen.findByTestId('companion-install');
        expect(screen.getByRole('heading', { name: 'Raid Ledger Companion' })).toBeInTheDocument();
        expect(screen.getByText('Beta')).toBeInTheDocument();
        expect(screen.queryByTestId('companion-install-more')).toBeNull();
        const steps = within(install).getAllByRole('listitem').map((li) => li.textContent);
        expect(steps).toEqual([
            'Install it and open it.',
            'Choose Link this computer. It shows an 8-letter code.',
            'Enter the code at /link, then turn on the games you want it to read.',
        ]);
        expect(within(install).getByRole('link', { name: '/link' })).toHaveAttribute('href', '/link');
        expect(screen.getByRole('heading', { name: 'Your computers' })).toBeInTheDocument();
        expect(screen.getByText('No computers linked yet.')).toBeInTheDocument();
    });

    it('Download opens the releases page in a new tab, with formats and the unsigned note', async () => {
        mockDevices([]);
        renderWithProviders(<CompanionDevicesSection />);
        const download = await screen.findByRole('link', { name: 'Download' });
        expect(download).toHaveAttribute('href', COMPANION_DOWNLOAD_URL);
        expect(download).toHaveAttribute('target', '_blank');
        expect(download).toHaveAttribute('rel', 'noopener noreferrer');
        expect(screen.getByTestId('companion-download-formats')).toHaveTextContent('Windows .exe · macOS .dmg');
        const note = screen.getByTestId('companion-unsigned-note');
        expect(note).toHaveTextContent('Unsigned test build.');
        expect(note).toHaveTextContent(COMPANION_UNSIGNED_NOTE.windows);
        expect(note).toHaveTextContent(COMPANION_UNSIGNED_NOTE.macos);
    });

    it('a revoked-only user counts as not linked', async () => {
        mockDevices([device({ state: 'revoked', revokedAt: '2026-10-20T12:00:00.000Z' })]);
        renderWithProviders(<CompanionDevicesSection />);
        await screen.findByTestId('companion-device-1');
        expect(screen.getByTestId('companion-install')).toBeVisible();
        expect(screen.queryByTestId('companion-install-more')).toBeNull();
    });
});

describe('Companion card — linked (ROK-2056 AC1)', () => {
    it('lists devices first, then a collapsed "Install on another computer"', async () => {
        mockDevices([device()]);
        renderWithProviders(<CompanionDevicesSection />);
        const row = await screen.findByTestId('companion-device-1');
        const more = screen.getByTestId('companion-install-more');
        expect(more).not.toHaveAttribute('open');
        expect(row.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Your computers' })).toBeNull();
        await userEvent.click(screen.getByText('Install on another computer'));
        expect(more).toHaveAttribute('open');
        expect(within(more).getByRole('link', { name: 'Download' })).toHaveAttribute('href', COMPANION_DOWNLOAD_URL);
    });
});

describe('Companion card — download flag off (ROK-2056 AC9)', () => {
    it('hides Download, formats and the unsigned note; steps and the device list stay', async () => {
        flag.on = false;
        mockDevices([device({ id: 2, state: 'revoked', revokedAt: '2026-10-20T12:00:00.000Z' })]);
        renderWithProviders(<CompanionDevicesSection />);
        await screen.findByTestId('companion-device-2');
        expect(screen.getByTestId('companion-install-steps')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Download' })).toBeNull();
        expect(screen.queryByTestId('companion-download-formats')).toBeNull();
        expect(screen.queryByTestId('companion-unsigned-note')).toBeNull();
    });
});

describe('Companion card anchors (ROK-2056 AC2)', () => {
    it.each(['#companion', '#companion-devices'])('%s scrolls the card into view', async (hash) => {
        mockDevices([]);
        const { container } = renderWithProviders(<CompanionDevicesSection />, {
            initialEntries: [`/profile/integrations${hash}`],
        });
        await screen.findByTestId('companion-install');
        await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));
        expect(scrollSpy.mock.contexts[0]).toBe(container.querySelector('#companion-devices'));
    });

    it('another hash does not scroll', async () => {
        mockDevices([]);
        renderWithProviders(<CompanionDevicesSection />, { initialEntries: ['/profile/integrations#calendars'] });
        await screen.findByTestId('companion-install');
        expect(scrollSpy).not.toHaveBeenCalled();
    });
});
