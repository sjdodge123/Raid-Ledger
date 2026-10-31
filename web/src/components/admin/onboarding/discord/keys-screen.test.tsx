/**
 * ROK-1703 4c — the keys screen's live states against MSW handlers for
 * `discord-bot/test` and the live `oauth/test` pair check (AC-4/5/7, D-5). Real timers: the 600 ms
 * debounce resolves inside findBy's window, no sleeps.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { DiscordBotTestResult } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { server } from '../../../../test/mocks/server';
import { KeysScreen } from './keys-screen';

const API = 'http://localhost:3000/admin/settings';
const APP_ID = '1290017734588641280';
const SECRET = 'abcdefghijklmnopqrstuvwxyz012345';
// A dummy in the bot-token shape, joined at runtime so secret scanning doesn't flag the literal.
const TOKEN = ['MTI5MDAxNzczNDU4ODY0MTI4MA', 'GabcDE', 'xyz_abcdefghijklmnopqrstuvwxyz0123'].join('.');

function botTest(result: DiscordBotTestResult): void {
    server.use(http.post(`${API}/discord-bot/test`, () => HttpResponse.json(result)));
}

function pairTest(result: { success: boolean; message: string; retryable?: boolean }, bodies: unknown[] = []): unknown[] {
    server.use(http.post(`${API}/oauth/test`, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json(result); }));
    return bodies;
}

function fill(label: RegExp, value: string): void {
    fireEvent.change(screen.getByLabelText(label, { selector: 'input' }), { target: { value } });
}

function renderKeys() {
    const onNext = vi.fn();
    renderWithProviders(<KeysScreen onNext={onNext} onBack={vi.fn()} />);
    return { onNext };
}

const continueButton = () => screen.getByRole('button', { name: 'Continue' });

describe('KeysScreen (4c)', () => {
    beforeEach(() => {
        botTest({ success: true, message: 'ok', applicationId: APP_ID, missingIntents: [] });
        pairTest({ success: true, message: 'Credentials verified successfully!' });
    });

    it('idle → checking → ✓ for a good token, and Continue enables once all three are ✓', async () => {
        renderKeys();
        expect(continueButton()).toBeDisabled();
        fill(/^Application ID/, APP_ID);
        fill(/^Client Secret/, SECRET);
        fill(/^Bot token/, TOKEN);
        expect(screen.getByText('Checking with Discord…')).toBeInTheDocument();
        expect(await screen.findByText(/Token works\. Your bot can sign in to Discord\./)).toBeInTheDocument();
        expect(await screen.findByText(/Discord accepted the ID and secret together\./)).toBeInTheDocument();
        expect(continueButton()).toBeEnabled();
    });

    it('checks the typed ID + secret pair live: checking → ✓ on both fields, with the typed pair as the body', async () => {
        const bodies = pairTest({ success: true, message: 'Credentials verified successfully!' });
        renderKeys();
        fill(/^Application ID/, APP_ID);
        fill(/^Client Secret/, ` ${SECRET} `);
        expect(screen.getByText('Checking the ID and secret with Discord…')).toBeInTheDocument();
        expect(screen.getByText('Checking with the secret…')).toBeInTheDocument();
        expect(await screen.findByText(/Discord accepted the ID and secret together\./)).toBeInTheDocument();
        expect(screen.getByText(/Discord found this application\./)).toBeInTheDocument();
        expect(bodies).toEqual([{ clientId: APP_ID, clientSecret: SECRET }]);
    });

    it('a rejected ID + secret pair shows ✗ on both fields and blocks Continue', async () => {
        pairTest({ success: false, message: 'Invalid Client ID or Client Secret' });
        renderKeys();
        fill(/^Application ID/, APP_ID);
        fill(/^Client Secret/, SECRET);
        fill(/^Bot token/, TOKEN);
        expect(await screen.findByText(/Invalid Client ID or Client Secret/)).toBeInTheDocument();
        expect(screen.getByText(/Discord didn't accept this ID with that secret/)).toBeInTheDocument();
        expect(screen.getByLabelText(/^Client Secret/, { selector: 'input' })).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText(/^Application ID/, { selector: 'input' })).toHaveAttribute('aria-invalid', 'true');
        await screen.findByText(/Token works/);
        expect(continueButton()).toBeDisabled();
    });

    it('does not ask Discord about the pair until both fields pass the format check', async () => {
        const bodies = pairTest({ success: true, message: 'ok' });
        renderKeys();
        fill(/^Application ID/, APP_ID);
        fill(/^Client Secret/, 'too-short');
        expect(screen.getByText(/That doesn't look like a client secret/)).toBeInTheDocument();
        fill(/^Bot token/, TOKEN);
        await screen.findByText(/Token works/);
        expect(bodies).toEqual([]);
    });

    it('✗ for a malformed Application ID, marked aria-invalid', () => {
        renderKeys();
        fill(/^Application ID/, '12ab');
        expect(screen.getByText(/An Application ID is 17 to 20 digits/)).toBeInTheDocument();
        expect(screen.getByLabelText(/^Application ID/, { selector: 'input' })).toHaveAttribute('aria-invalid', 'true');
    });

    it('a local format error offers no Check again (re-checking the same value cannot help)', () => {
        renderKeys();
        fill(/^Application ID/, '12ab');
        expect(screen.getByText(/An Application ID is 17 to 20 digits/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
    });

    it('token == secret is caught without asking Discord', () => {
        renderKeys();
        fill(/^Client Secret/, TOKEN.replace(/\./g, ''));
        fill(/^Bot token/, TOKEN.replace(/\./g, ''));
        expect(screen.getByText(/That's your client secret\. The bot token is on the Bot page/)).toBeInTheDocument();
    });

    it('a token from a different application is rejected', async () => {
        botTest({ success: true, message: 'ok', applicationId: '999999999999999999', missingIntents: [] });
        renderKeys();
        fill(/^Application ID/, APP_ID);
        fill(/^Bot token/, TOKEN);
        expect(await screen.findByText(/This token belongs to a different application/)).toBeInTheDocument();
        expect(continueButton()).toBeDisabled();
    });

    it('missingIntents names the switch that is off and blocks Continue', async () => {
        botTest({ success: false, message: 'Missing required privileged intent', applicationId: APP_ID, missingIntents: ['messageContent'] });
        renderKeys();
        fill(/^Application ID/, APP_ID);
        fill(/^Client Secret/, SECRET);
        fill(/^Bot token/, TOKEN);
        expect(await screen.findByText('Discord says Message Content Intent is off. Turn it on, click Save Changes, then click Check again.')).toBeInTheDocument();
        expect(screen.getByTitle('Message Content Intent is off')).toBeInTheDocument();
        expect(continueButton()).toBeDisabled();
    });

    it('a successful token with missingIntents: [] shows all three switches on and ticked', async () => {
        renderKeys();
        fill(/^Application ID/, APP_ID);
        fill(/^Bot token/, TOKEN);
        await screen.findByText(/Token works/);
        for (const label of ['Presence Intent', 'Server Members Intent', 'Message Content Intent']) {
            expect(screen.getByTitle(`${label} is on`), `${label} chip`).toBeInTheDocument();
            expect(screen.getByRole('checkbox', { name: label }), `${label} checkbox`).toBeChecked();
        }
    });

    it('missing intent → switch turned on → Check again re-asks with the SAME token and enables Continue', async () => {
        let calls = 0;
        server.use(http.post(`${API}/discord-bot/test`, () => {
            calls += 1;
            return HttpResponse.json(calls === 1
                ? { success: false, message: 'Missing intent', applicationId: APP_ID, missingIntents: ['messageContent'] }
                : { success: true, message: 'ok', applicationId: APP_ID, missingIntents: [] });
        }));
        renderKeys();
        fill(/^Application ID/, APP_ID);
        fill(/^Client Secret/, SECRET);
        fill(/^Bot token/, TOKEN);
        await screen.findByTitle('Message Content Intent is off');
        await screen.findByText(/Discord accepted the ID and secret together\./);
        expect(continueButton()).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
        expect(await screen.findByText(/Token works\. Your bot can sign in to Discord\./)).toBeInTheDocument();
        expect(calls).toBe(2);
        await waitFor(() => expect(continueButton()).toBeEnabled());
    });

    it('a pair Discord was too busy to check is unverified: no ✓, Continue blocked, Check again re-asks', async () => {
        const busy = "Discord is busy and couldn't check the ID and secret right now. Try again in a moment.";
        const bodies = pairTest({ success: false, retryable: true, message: busy });
        renderKeys();
        fill(/^Application ID/, APP_ID);
        fill(/^Client Secret/, SECRET);
        fill(/^Bot token/, TOKEN);
        expect(await screen.findAllByText(busy)).toHaveLength(2);
        await screen.findByText(/Token works/);
        expect(screen.queryByText(/Discord accepted the ID and secret together/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Discord didn't accept this ID/)).not.toBeInTheDocument();
        expect(continueButton()).toBeDisabled();
        pairTest({ success: true, message: 'Credentials verified successfully!' }, bodies);
        fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
        expect(await screen.findByText(/Discord accepted the ID and secret together\./)).toBeInTheDocument();
        expect(bodies).toHaveLength(2);
        expect(continueButton()).toBeEnabled();
    });

    it('Continue saves OAuth then the bot without re-testing the pair, then moves on', async () => {
        const calls: string[] = [];
        server.use(
            http.put(`${API}/oauth`, () => { calls.push('oauth'); return HttpResponse.json({ success: true, message: 'saved' }); }),
            http.post(`${API}/oauth/test`, () => { calls.push('oauth/test'); return HttpResponse.json({ success: true, message: 'ok' }); }),
            http.put(`${API}/discord-bot`, () => { calls.push('bot'); return HttpResponse.json({ success: true, message: 'saved' }); }),
        );
        const { onNext } = renderKeys();
        fill(/^Application ID/, APP_ID);
        fill(/^Client Secret/, SECRET);
        fill(/^Bot token/, TOKEN);
        await screen.findByText(/Token works/);
        await screen.findByText(/Discord accepted the ID and secret together\./);
        expect(calls).toEqual(['oauth/test']);
        fireEvent.click(continueButton());
        await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1));
        expect(calls).toEqual(['oauth/test', 'oauth', 'bot']);
    });
});
