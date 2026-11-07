/**
 * ROK-2129 spike: the DEMO_MODE-only Battle.net account probe section inside
 * the WoW Forever admin panel — gated on demoMode (AC13), Start posts the
 * region and navigates to Blizzard (AC14), the `?bnetProbe=` banner and the
 * keys-only last result (AC15).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { BnetProbeResult, BnetProbeStateDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { BnetAccountProbeSection } from './bnet-account-probe-section';

const API = 'http://localhost:3000';
const BASE = `${API}/admin/plugins/blizzard/bnet-account-probe`;
const REDIRECT = 'https://slot-1.gamernight.net/api/plugins/blizzard/bnet-account-probe/callback';
const AUTHORIZE = 'https://oauth.battle.net/authorize?response_type=code&scope=wow.profile';
const SECRET = 'Thrall-Secretrealm';

function makeResult(overrides: Partial<BnetProbeResult> = {}): BnetProbeResult {
    return {
        at: '2026-11-07T12:00:00.000Z',
        region: 'us',
        scopeRequested: 'wow.profile',
        token: {
            status: 200, host: 'oauth.battle.net', keys: ['access_token', 'expires_in', 'scope', 'token_type'],
            expiresIn: 86399, refreshTokenIssued: false, idTokenIssued: false, scope: 'wow.profile', pkceAccepted: true,
        },
        namespaces: [
            {
                namespace: 'profile-forever-us', status: 200, error: null,
                summary: {
                    topLevelKeys: ['_links', 'id', 'wow_accounts'], wowAccountCount: 1, characterCount: 7,
                    accountKeys: ['characters', 'id'], characterKeys: ['character', 'level', 'protected_character'],
                    characterKeyFrequency: { character: 7, level: 7 }, nestedKeys: { realm: ['id', 'key'] },
                    hrefShapes: { realmless: 5, realm: 2, none: 0 },
                },
            },
            { namespace: 'profile-us', status: 404, error: null, summary: null },
            { namespace: 'profile-classic-us', status: null, error: 'timeout', summary: null },
        ],
        idParity: { checked: 7, matched: 6, mismatched: 0, notFound: 1, errors: 0, viaHref: 5, viaName: 2 },
        error: null,
        ...overrides,
    };
}

let demoMode = true;
let state: BnetProbeStateDto;
let posts: unknown[] = [];
let stateGets = 0;
let statusGets = 0;
const originalLocation = window.location;
const assign = vi.fn();

beforeEach(() => {
    demoMode = true;
    state = { redirectUri: REDIRECT, result: null };
    posts = [];
    stateGets = 0;
    statusGets = 0;
    assign.mockReset();
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { ...originalLocation, assign } });
    server.use(
        http.get(`${API}/system/status`, () => {
            statusGets += 1;
            return HttpResponse.json({ status: 'ok', claimRequired: false, demoMode });
        }),
        http.get(BASE, () => {
            stateGets += 1;
            return HttpResponse.json(state);
        }),
        http.post(`${BASE}/start`, async ({ request }) => {
            posts.push(await request.json());
            return HttpResponse.json({ url: AUTHORIZE });
        }),
    );
});

afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: originalLocation });
});

const heading = (): HTMLElement => screen.getByRole('heading', { name: 'Battle.net account probe' });

describe('BnetAccountProbeSection — DEMO_MODE gate (AC13)', () => {
    it('renders nothing and never reads the probe state when demoMode is false', async () => {
        demoMode = false;
        const { container } = renderWithProviders(<BnetAccountProbeSection />);
        await waitFor(() => expect(statusGets).toBe(1));
        expect(screen.queryByRole('heading', { name: 'Battle.net account probe' })).toBeNull();
        expect(container).toBeEmptyDOMElement();
        expect(stateGets).toBe(0);
    });

    it('shows the section with the copyable redirect URI when demoMode is true', async () => {
        renderWithProviders(<BnetAccountProbeSection />);
        expect(await screen.findByRole('heading', { name: 'Battle.net account probe' })).toBeInTheDocument();
        expect(await screen.findByDisplayValue(REDIRECT)).toHaveAttribute('readonly');
        expect(screen.getByRole('button', { name: 'Copy redirect URI' })).toBeInTheDocument();
        expect(screen.getByText('The probe has not run yet.')).toBeInTheDocument();
    });
});

describe('BnetAccountProbeSection — Start (AC14)', () => {
    it('posts the chosen region and navigates to the returned Battle.net authorize URL', async () => {
        const user = userEvent.setup();
        renderWithProviders(<BnetAccountProbeSection />);
        await user.selectOptions(await screen.findByLabelText('Region'), 'eu');
        await user.click(screen.getByRole('button', { name: 'Start Battle.net account probe' }));
        await waitFor(() => expect(assign).toHaveBeenCalledWith(AUTHORIZE));
        expect(posts).toEqual([{ region: 'eu' }]);
    });

    it('defaults the region to us', async () => {
        const user = userEvent.setup();
        renderWithProviders(<BnetAccountProbeSection />);
        await user.click(await screen.findByRole('button', { name: 'Start Battle.net account probe' }));
        await waitFor(() => expect(posts).toEqual([{ region: 'us' }]));
    });
});

describe('BnetAccountProbeSection — callback banner (AC15)', () => {
    it('shows the success notice for ?bnetProbe=ok', async () => {
        renderWithProviders(<BnetAccountProbeSection />, { initialEntries: ['/?bnetProbe=ok'] });
        expect(await screen.findByText('Battle.net probe recorded.')).toBeInTheDocument();
    });

    it('shows the state-error copy for ?bnetProbe=error&code=state', async () => {
        renderWithProviders(<BnetAccountProbeSection />, { initialEntries: ['/?bnetProbe=error&code=state'] });
        expect(await screen.findByText(/Battle\.net probe failed: the sign-in link was invalid, expired or already used/)).toBeInTheDocument();
    });

    it('shows no banner without the query param', async () => {
        renderWithProviders(<BnetAccountProbeSection />);
        await screen.findByRole('heading', { name: 'Battle.net account probe' });
        expect(screen.queryByText(/Battle\.net probe (recorded|failed)/)).toBeNull();
    });
});

describe('BnetAccountProbeSection — last result, keys only (AC15)', () => {
    it('renders token keys, namespace rows with counts and key lists, and ID parity counts', async () => {
        state = { redirectUri: REDIRECT, result: makeResult() };
        renderWithProviders(<BnetAccountProbeSection />);
        const token = await screen.findByRole('list', { name: 'Token response' });
        expect(within(token).getByText('access_token, expires_in, scope, token_type')).toBeInTheDocument();
        expect(within(token).getByText('86399')).toBeInTheDocument();
        const rows = screen.getByRole('list', { name: 'Account summary by namespace' });
        expect(within(rows).getByText('profile-forever-us')).toBeInTheDocument();
        expect(within(rows).getByText(/HTTP 200 · 1 account · 7 characters/)).toBeInTheDocument();
        expect(within(rows).getByText(/HTTP 404/)).toBeInTheDocument();
        expect(within(rows).getByText(/timeout/)).toBeInTheDocument();
        expect(within(rows).getByText('character, level, protected_character')).toBeInTheDocument();
        expect(within(rows).getByText(/realmless 5 · realm 2 · none 0/)).toBeInTheDocument();
        const parity = screen.getByRole('list', { name: 'ID parity' });
        expect(within(parity).getByText(/checked 7 · matched 6 · mismatched 0 · not found 1 · errors 0/)).toBeInTheDocument();
    });

    it('never renders a value smuggled in beside the keys-only fields', async () => {
        const result = makeResult();
        const smuggled = { ...result, characterName: SECRET, namespaces: result.namespaces.map((n) => ({ ...n, realm: SECRET })) };
        server.use(http.get(BASE, () => HttpResponse.json({ redirectUri: REDIRECT, result: smuggled, token: SECRET })));
        renderWithProviders(<BnetAccountProbeSection />);
        await screen.findByRole('list', { name: 'Account summary by namespace' });
        expect(document.body.textContent ?? '').not.toContain(SECRET);
    });

    it('shows the run error and no token block when the run ended before a token existed', async () => {
        state = { redirectUri: REDIRECT, result: makeResult({ token: null, namespaces: [], idParity: null, error: 'denied' }) };
        renderWithProviders(<BnetAccountProbeSection />);
        expect(await screen.findByText(/ended with: denied/)).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Token response' })).toBeNull();
    });
});
