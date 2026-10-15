/**
 * Pelican admin panel — Connection section (ROK-121). Drives the real panel,
 * hooks and form against a stateful MSW server; assertions are about the PUT
 * body that left the page and what rendered from the GET that came back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { PELICAN_ERROR_KINDS, type PelicanConfig, type PelicanConfigUpdate } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    PELICAN_CONFIG_URL, PELICAN_TEST_URL, applyPelicanUpdate, pelicanConfigFixture, pelicanConfiguredFixture,
} from '../../../test/mocks/pelican-handlers';
import { toast } from '../../../lib/toast';
import { PelicanPluginContent } from './pelican-plugin-content';

vi.mock('../../../hooks/use-auth', () => ({ getAuthToken: vi.fn(() => 'test-token') }));
vi.mock('../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function servePelican(initial: PelicanConfig): PelicanConfigUpdate[] {
    let state = initial;
    const puts: PelicanConfigUpdate[] = [];
    server.use(
        http.get(PELICAN_CONFIG_URL, () => HttpResponse.json(state)),
        http.put(PELICAN_CONFIG_URL, async ({ request }) => {
            const body = (await request.json()) as PelicanConfigUpdate;
            puts.push(body);
            state = applyPelicanUpdate(state, body);
            return HttpResponse.json(state);
        }),
    );
    return puts;
}

async function renderPanel(initial: PelicanConfig) {
    const puts = servePelican(initial);
    renderWithProviders(<PelicanPluginContent pluginSlug="pelican" integrationKey="pelican-panel" />);
    await screen.findByLabelText('Panel URL');
    return puts;
}

const urlInput = () => screen.getByLabelText('Panel URL') as HTMLInputElement;
const keyInput = () => screen.getByLabelText('Client API key', { selector: 'input' }) as HTMLInputElement;
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));
const testButton = () => screen.queryByRole('button', { name: 'Test Connection' });
/** getByRole throws when the button is missing — no `as HTMLElement` over a nullable query. */
const clickTest = () => fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

beforeEach(() => vi.clearAllMocks());

describe('PelicanPluginContent — render states', () => {
    it('not configured: Offline, no saved secret, empty fields, no Test', async () => {
        await renderPanel(pelicanConfigFixture);
        expect(screen.getByText('Offline')).toBeInTheDocument();
        expect(screen.getByText('No secret saved yet.')).toBeInTheDocument();
        expect(urlInput().value).toBe('');
        expect(keyInput().value).toBe('');
        expect(testButton()).toBeNull();
        // ROK-1795: the plugin has no timezone setting any more.
        expect(screen.queryByText(/timezone/i)).toBeNull();
        expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('configured: Online, Saved chip, URL prefilled, key input empty, Test visible', async () => {
        await renderPanel(pelicanConfiguredFixture);
        expect(screen.getByText('Online')).toBeInTheDocument();
        expect(screen.getByTestId('pelican-key-saved')).toHaveTextContent('Saved');
        expect(urlInput().value).toBe('https://panel.example.test');
        expect(keyInput().value).toBe('');
        expect(testButton()).not.toBeNull();
    });

    it('half-configured (URL only) stays Offline with no Test (AC2)', async () => {
        await renderPanel({ ...pelicanConfiguredFixture, apiKeySet: false });
        expect(screen.getByText('Offline')).toBeInTheDocument();
        expect(testButton()).toBeNull();
    });

    it('renders nothing for another plugin or integration', () => {
        const { container } = renderWithProviders(<PelicanPluginContent pluginSlug="ai" integrationKey="pelican-panel" />);
        expect(container).toBeEmptyDOMElement();
        const other = renderWithProviders(<PelicanPluginContent pluginSlug="pelican" integrationKey="other" />);
        expect(other.container).toBeEmptyDOMElement();
    });
});

describe('PelicanPluginContent — editing and saving', () => {
    it('a URL edit is dirty, hides Test, and PUTs only the URL (key omitted)', async () => {
        const puts = await renderPanel(pelicanConfiguredFixture);
        fireEvent.change(urlInput(), { target: { value: 'https://new.example.test' } });
        expect(screen.getByTestId('pelican-unsaved')).toBeInTheDocument();
        expect(testButton()).toBeNull();
        save();
        await waitFor(() => expect(puts).toEqual([{ panelUrl: 'https://new.example.test' }]));
        await waitFor(() => expect(screen.queryByTestId('pelican-unsaved')).toBeNull());
    });

    it('Remove saved secret sends apiKey "" and the card goes Offline', async () => {
        const puts = await renderPanel(pelicanConfiguredFixture);
        fireEvent.click(screen.getByRole('button', { name: 'Remove saved Pelican client API key' }));
        save();
        await waitFor(() => expect(puts).toEqual([{ apiKey: '' }]));
        expect(await screen.findByText('No secret saved yet.')).toBeInTheDocument();
        expect(screen.getByText('Offline')).toBeInTheDocument();
    });

    it('typing a papp_ key shows the inline application-key hint', async () => {
        await renderPanel(pelicanConfigFixture);
        expect(screen.queryByTestId('pelican-papp-hint')).toBeNull();
        fireEvent.change(keyInput(), { target: { value: 'papp_example' } });
        expect(screen.getByTestId('pelican-papp-hint')).toHaveTextContent('use a client key (pacc_)');
    });

    it('a PUT 400 toasts the server message and keeps the draft', async () => {
        await renderPanel(pelicanConfigFixture);
        server.use(http.put(PELICAN_CONFIG_URL, () =>
            // Nest's BadRequestException(string[]) body shape: `message` is an array.
            HttpResponse.json({ message: ['Panel URL must start with http:// or https://'] }, { status: 400 })));
        fireEvent.change(urlInput(), { target: { value: 'ftp://x' } });
        save();
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Panel URL must start with http:// or https://'));
        expect(urlInput().value).toBe('ftp://x');
    });
});

describe('PelicanPluginContent — Test Connection banners', () => {
    it('ok shows the success banner with the server count copy', async () => {
        await renderPanel(pelicanConfiguredFixture);
        server.use(http.post(PELICAN_TEST_URL, () => HttpResponse.json({
            success: true, code: 'ok', message: 'OK — 3 server(s) visible to this key.', serverCount: 3,
        })));
        clickTest();
        expect(await screen.findByText('OK — 3 server(s) visible to this key.')).toHaveClass('text-success');
    });

    it.each(PELICAN_ERROR_KINDS)('%s shows its own danger banner', async (code) => {
        await renderPanel(pelicanConfiguredFixture);
        server.use(http.post(PELICAN_TEST_URL, () => HttpResponse.json({ success: false, code, message: `message for ${code}` })));
        clickTest();
        expect(await screen.findByText(`message for ${code}`)).toHaveClass('text-danger');
    });
});
