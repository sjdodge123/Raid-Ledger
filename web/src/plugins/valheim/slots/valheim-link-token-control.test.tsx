/**
 * Valheim Link token control (ROK-1833): status from the list route, the
 * show-once dialog, and the rotate / revoke confirms — against MSW.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ValheimLinkTokenStatus } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    VALHEIM_LINK_TOKENS_URL, VALHEIM_LINK_TOKEN_URL, VALHEIM_LINK_TOKEN_ROTATE_URL, VALHEIM_RAW_TOKEN,
    valheimTokenActive, valheimTokenIssued, valheimTokenNone,
} from '../../../test/mocks/valheim-link-handlers';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { ValheimLinkTokenControl } from './valheim-link-token-control';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));
vi.mock('../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const originalMatchMedia = window.matchMedia;
beforeEach(() => {
    window.matchMedia = (query: string) => ({
        matches: query === DESKTOP_MQ, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
    });
});
afterEach(() => { window.matchMedia = originalMatchMedia; });

interface Calls { issue: unknown[]; rotate: number; revoke: number }

/** Serves the list and records every write. `issueStatus` answers the POST with an error. */
function serve(statuses: ValheimLinkTokenStatus[], issueStatus?: number): Calls {
    const calls: Calls = { issue: [], rotate: 0, revoke: 0 };
    server.use(
        http.get(VALHEIM_LINK_TOKENS_URL, () => HttpResponse.json({ data: statuses })),
        http.post(VALHEIM_LINK_TOKEN_ROTATE_URL, () => { calls.rotate += 1; return HttpResponse.json(valheimTokenIssued, { status: 201 }); }),
        http.post(VALHEIM_LINK_TOKEN_URL, async ({ request }) => {
            calls.issue.push(await request.json());
            if (issueStatus) return HttpResponse.json({ message: 'nope' }, { status: issueStatus });
            return HttpResponse.json(valheimTokenIssued, { status: 201 });
        }),
        http.delete(VALHEIM_LINK_TOKEN_URL, () => {
            calls.revoke += 1;
            return HttpResponse.json({ ...valheimTokenActive, state: 'revoked', revokedAt: '2026-10-02T00:00:00.000Z' });
        }),
    );
    return calls;
}

function renderControl(serverId = 7) {
    return renderWithProviders(<ValheimLinkTokenControl serverId={serverId} gameId={5} serverName="Valheim — Main" inline />);
}

describe('ValheimLinkTokenControl', () => {
    it('is disabled with a hint when the server is not mapped to Valheim', async () => {
        serve([valheimTokenNone]);
        renderControl(99);
        const button = await screen.findByRole('button', { name: 'Generate token' });
        expect(button).toBeDisabled();
        expect(screen.getByTestId('valheim-link-token-99-unmapped')).toHaveAttribute('title', expect.stringContaining('Valheim'));
    });

    it('shows active-since, Rotate and Revoke for a live token', async () => {
        serve([valheimTokenActive]);
        renderControl();
        expect(await screen.findByText('…ab12')).toBeInTheDocument();
        expect(screen.getByText(/Active since/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Rotate' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    });

    it('Generate opens the show-once dialog masked; Show reveals, Copy copies, closing drops it', async () => {
        const user = userEvent.setup();
        // The async Clipboard API path (the one a real HTTPS origin takes); userEvent stubs the clipboard.
        Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
        const calls = serve([valheimTokenNone]);
        renderControl();
        await user.click(await screen.findByRole('button', { name: 'Generate token' }));
        const dialog = await screen.findByRole('dialog', { name: 'Mod token for Valheim — Main' });
        const field = within(dialog).getByTestId('valheim-link-token-value');
        expect(field).toHaveAttribute('type', 'password');
        expect(calls.issue).toEqual([{}]);
        await user.click(within(dialog).getByRole('button', { name: 'Show token' }));
        expect(field).toHaveAttribute('type', 'text');
        expect(field).toHaveValue(VALHEIM_RAW_TOKEN);
        await user.click(within(dialog).getByRole('button', { name: 'Copy token' }));
        await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(VALHEIM_RAW_TOKEN));
        await user.click(within(dialog).getByRole('button', { name: 'Done' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(document.body.innerHTML).not.toContain(VALHEIM_RAW_TOKEN);
    });

    it('closing before copying asks "Leave without copying the token?"', async () => {
        const user = userEvent.setup();
        serve([valheimTokenNone]);
        renderControl();
        await user.click(await screen.findByRole('button', { name: 'Generate token' }));
        const dialog = await screen.findByRole('dialog', { name: 'Mod token for Valheim — Main' });
        await user.click(within(dialog).getByRole('button', { name: 'Done' }));
        expect(await screen.findByText('Leave without copying the token?')).toBeInTheDocument();
    });

    it('lists the BepInEx config keys and the two endpoints', async () => {
        const user = userEvent.setup();
        serve([valheimTokenNone]);
        renderControl();
        await user.click(await screen.findByRole('button', { name: 'Generate token' }));
        const steps = await screen.findByTestId('valheim-link-token-instructions');
        const origin = window.location.origin;
        expect(steps).toHaveTextContent(`RaidLedger.BaseUrl = ${origin}`);
        expect(steps).toHaveTextContent('RaidLedger.ServerId = 7');
        expect(steps).toHaveTextContent('RaidLedger.ServerToken');
        expect(steps).toHaveTextContent(`POST ${origin}/api/plugins/valheim/link/messages/{kind}`);
        expect(steps).toHaveTextContent(`PUT ${origin}/api/plugins/valheim/link/blobs/{sha256}`);
    });

    it('Rotate asks first, then calls the rotate route and shows the new token', async () => {
        const user = userEvent.setup();
        const calls = serve([valheimTokenActive]);
        renderControl();
        await user.click(await screen.findByRole('button', { name: 'Rotate' }));
        const confirm = await screen.findByRole('dialog', { name: 'Rotate the mod token?' });
        expect(confirm).toHaveTextContent('stops working immediately');
        expect(calls.rotate).toBe(0);
        await user.click(within(confirm).getByRole('button', { name: 'Rotate token' }));
        await screen.findByRole('dialog', { name: 'Mod token for Valheim — Main' });
        expect(calls.rotate).toBe(1);
    });

    it('Revoke asks first, then calls DELETE', async () => {
        const user = userEvent.setup();
        const calls = serve([valheimTokenActive]);
        renderControl();
        await user.click(await screen.findByRole('button', { name: 'Revoke' }));
        const confirm = await screen.findByRole('dialog', { name: 'Revoke the mod token?' });
        await user.click(within(confirm).getByRole('button', { name: 'Revoke token' }));
        await waitFor(() => expect(calls.revoke).toBe(1));
    });

    it('a 409 shows an inline danger banner', async () => {
        const user = userEvent.setup();
        serve([valheimTokenNone], 409);
        renderControl();
        await user.click(await screen.findByRole('button', { name: 'Generate token' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('already has an active token');
    });

    it('renders nothing when the list route is refused (Valheim inactive)', async () => {
        server.use(http.get(VALHEIM_LINK_TOKENS_URL, () => HttpResponse.json({ message: 'x' }, { status: 403 })));
        const { container } = renderControl();
        await waitFor(() => expect(container).toBeEmptyDOMElement());
    });
});
