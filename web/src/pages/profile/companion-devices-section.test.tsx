/** ROK-1955 T-WEB-5 — the Companion devices card on My Integrations. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { CompanionDevice } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { CompanionDevicesSection } from './companion-devices-section';

const API = 'http://localhost:3000';
const LIST = `${API}/companion/v1/devices`;
const ONE = `${API}/companion/v1/devices/:id`;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function device(over: Partial<CompanionDevice> = {}): CompanionDevice {
    return {
        id: 1, name: 'Gaming-PC', os: 'windows', osVersion: '11', appVersion: '0.1.0', tokenHint: 'ab12',
        createdAt: '2026-10-12T12:00:00.000Z', lastUsedAt: new Date(Date.now() - 5 * MIN).toISOString(),
        lastUsedNetwork: '203.0.113.x', revokedAt: null, state: 'active', ...over,
    };
}

const revokedMac = (): CompanionDevice => device({
    id: 2, name: 'MacBook', os: 'macos', tokenHint: '9f3c', state: 'revoked',
    revokedAt: new Date(Date.now() - 3 * DAY).toISOString(),
});

interface Recorded { patches: unknown[]; deletes: string[] }

/** Stateful list: PATCH renames, DELETE revokes, GET returns the current rows. */
function mockDevices(initial: CompanionDevice[]): Recorded {
    let rows = initial;
    const rec: Recorded = { patches: [], deletes: [] };
    server.use(
        http.get(LIST, () => HttpResponse.json({ data: rows })),
        http.patch(ONE, async ({ request, params }) => {
            const body = await request.json();
            rec.patches.push(body);
            const name = typeof body === 'object' && body !== null && 'name' in body ? String(body.name) : '';
            rows = rows.map((d) => (String(d.id) === params.id ? { ...d, name } : d));
            return HttpResponse.json(rows.find((d) => String(d.id) === params.id));
        }),
        http.delete(ONE, ({ params }) => {
            rec.deletes.push(String(params.id));
            const revokedAt = new Date().toISOString();
            rows = rows.map((d) => (String(d.id) === params.id ? { ...d, state: 'revoked', revokedAt } : d));
            return new HttpResponse(null, { status: 204 });
        }),
    );
    return rec;
}

const rowOf = (id: number): HTMLElement => screen.getByTestId(`companion-device-${id}`);

const scrollSpy = vi.fn();
beforeEach(() => { scrollSpy.mockReset(); Element.prototype.scrollIntoView = scrollSpy; });
afterEach(() => { server.resetHandlers(); });

describe('CompanionDevicesSection (ROK-1955 T-WEB-5)', () => {
    it('renders the card anchor and the empty state', async () => {
        mockDevices([]);
        const { container } = renderWithProviders(<CompanionDevicesSection />);
        expect(await screen.findByText(/No computers linked/)).toBeInTheDocument();
        expect(container.querySelector('#companion-devices')).not.toBeNull();
        expect(screen.getByRole('heading', { name: 'Companion devices' })).toBeInTheDocument();
    });

    it('lists an active device with chip, last seen, linked date and token hint', async () => {
        mockDevices([device(), device({ id: 3, name: 'Spare-PC', os: 'linux', lastUsedAt: null, lastUsedNetwork: null })]);
        renderWithProviders(<CompanionDevicesSection />);
        const row = await screen.findByTestId('companion-device-1');
        expect(within(row).getByText('Gaming-PC')).toBeInTheDocument();
        expect(within(row).getByText('Active')).toBeInTheDocument();
        expect(within(row).getByText('Last seen 5 min ago from 203.0.113.x')).toBeInTheDocument();
        expect(within(row).getByText('Linked 12 Oct 2026 · token …ab12')).toBeInTheDocument();
        expect(within(rowOf(3)).getByText('Never used')).toBeInTheDocument();
    });

    it('a revoked row is dimmed with "Removed 3 days ago" and has no actions', async () => {
        mockDevices([device(), revokedMac()]);
        renderWithProviders(<CompanionDevicesSection />);
        const row = await screen.findByTestId('companion-device-2');
        expect(within(row).getByText('Removed')).toBeInTheDocument();
        expect(within(row).getByText('Removed 3 days ago · token …9f3c')).toBeInTheDocument();
        expect(within(row).queryByRole('button')).toBeNull();
        expect(within(rowOf(1)).getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    });

});

describe('CompanionDevicesSection actions (ROK-1955 T-WEB-5)', () => {
    it('rename: inline input, Save sends PATCH and the row shows the new name', async () => {
        const rec = mockDevices([device()]);
        const user = userEvent.setup();
        renderWithProviders(<CompanionDevicesSection />);
        await user.click(await screen.findByRole('button', { name: 'Rename' }));
        const input = within(rowOf(1)).getByRole('textbox', { name: 'Device name' });
        expect(input).toHaveValue('Gaming-PC');
        await user.clear(input);
        await user.type(input, 'Desk-PC');
        await user.click(within(rowOf(1)).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(rec.patches).toEqual([{ name: 'Desk-PC' }]));
        expect(await within(rowOf(1)).findByText('Desk-PC')).toBeInTheDocument();
        expect(within(rowOf(1)).queryByRole('textbox')).toBeNull();
    });

    it('rename: an empty name shows an inline error and sends nothing', async () => {
        const rec = mockDevices([device()]);
        const user = userEvent.setup();
        renderWithProviders(<CompanionDevicesSection />);
        await user.click(await screen.findByRole('button', { name: 'Rename' }));
        await user.clear(within(rowOf(1)).getByRole('textbox', { name: 'Device name' }));
        await user.click(within(rowOf(1)).getByRole('button', { name: 'Save' }));
        expect(await within(rowOf(1)).findByText('Enter a name of up to 64 characters.')).toBeInTheDocument();
        expect(rec.patches).toEqual([]);
    });

    it('remove: confirm, then DELETE and the row becomes Removed', async () => {
        const rec = mockDevices([device()]);
        const user = userEvent.setup();
        renderWithProviders(<CompanionDevicesSection />);
        await user.click(await screen.findByRole('button', { name: 'Remove' }));
        expect(await screen.findByText(/Remove Gaming-PC\? It stops uploading immediately/)).toBeInTheDocument();
        expect(rec.deletes).toEqual([]);
        await user.click(screen.getByTestId('companion-device-confirm-remove'));
        await waitFor(() => expect(rec.deletes).toEqual(['1']));
        expect(await within(rowOf(1)).findByText('Removed')).toBeInTheDocument();
        expect(within(rowOf(1)).queryByRole('button')).toBeNull();
    });

    it('a failed load shows the danger banner and Retry reloads', async () => {
        server.use(http.get(LIST, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
        const user = userEvent.setup();
        renderWithProviders(<CompanionDevicesSection />);
        expect(await screen.findByText("Couldn't load your devices.")).toBeInTheDocument();
        mockDevices([device()]);
        await user.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByTestId('companion-device-1')).toBeInTheDocument();
        expect(screen.queryByText("Couldn't load your devices.")).toBeNull();
    });
});

describe('CompanionDevicesSection focus and anchor (ROK-1955 web review)', () => {
    it('#companion-devices scrolls the card into view once the list has loaded', async () => {
        mockDevices([device()]);
        const { container } = renderWithProviders(<CompanionDevicesSection />, {
            initialEntries: ['/profile/integrations#companion-devices'],
        });
        await screen.findByTestId('companion-device-1');
        await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));
        expect(scrollSpy.mock.contexts[0]).toBe(container.querySelector('#companion-devices'));
    });

    it('without the hash nothing scrolls', async () => {
        mockDevices([device()]);
        renderWithProviders(<CompanionDevicesSection />, { initialEntries: ['/profile/integrations'] });
        await screen.findByTestId('companion-device-1');
        expect(scrollSpy).not.toHaveBeenCalled();
    });

    it('rename focuses the input, and Cancel returns focus to Rename', async () => {
        mockDevices([device()]);
        const user = userEvent.setup();
        renderWithProviders(<CompanionDevicesSection />);
        await user.click(await screen.findByRole('button', { name: 'Rename' }));
        expect(within(rowOf(1)).getByRole('textbox', { name: 'Device name' })).toHaveFocus();
        await user.click(within(rowOf(1)).getByRole('button', { name: 'Cancel' }));
        expect(within(rowOf(1)).getByRole('button', { name: 'Rename' })).toHaveFocus();
    });

    it('a saved rename returns focus to Rename', async () => {
        mockDevices([device()]);
        const user = userEvent.setup();
        renderWithProviders(<CompanionDevicesSection />);
        await user.click(await screen.findByRole('button', { name: 'Rename' }));
        await user.type(within(rowOf(1)).getByRole('textbox', { name: 'Device name' }), '-2');
        await user.click(within(rowOf(1)).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(within(rowOf(1)).getByRole('button', { name: 'Rename' })).toHaveFocus());
    });
});
