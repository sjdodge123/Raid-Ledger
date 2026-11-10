/**
 * ROK-2153 S3b review r1 — overlay state resets, error placement, the fail-closed
 * options gate, the dismiss toast and AC1's zero-request guarantee.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useQuery } from '@tanstack/react-query';
import type { GuildPage, HubClaimStatus } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { buildHubClaimCandidate, buildHubClaimResult, buildHubClaimStatus, hubClaimErrorHandler, hubClaimPostHandler, type HubClaimCall } from '../../../test/mocks/hub-claim-handlers';
import { usePluginStore } from '../../../stores/plugin-store';
import { toast } from '../../../lib/toast';
import { addHubClaimProvider, clearHubClaimProviders, type HubClaimOptionsStepProps, type HubClaimProvider } from './hub-claim-providers';
import { HubClaimPromptCell } from './hub-claim-prompt-cell';

vi.mock('../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const API = 'http://localhost:3000';
const ONBOARDING = `${API}/guilds/onboarding`;
const PROMPT = 'hub-claim-prompt';
const CONTROL_ID = 9;
const THRALL = buildHubClaimCandidate();
const JAINA = buildHubClaimCandidate({ id: 'c-2', name: 'Jaina', subtitle: null, match: 'strong', matchReason: 'steam_link' });

function page(id = 7): GuildPage {
    return {
        guild: { id, gameId: 1, kind: 'game_server', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 1, lastSnapshotAt: null, gameSlug: 'valheim' },
        importedBy: null,
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

function RulesetStep({ onSubmit }: HubClaimOptionsStepProps) {
    return <button type="button" onClick={() => { onSubmit({ ruleset: 'hardcore' }); }}>Use Hardcore</button>;
}

function register(over: Partial<HubClaimProvider> = {}): void {
    addHubClaimProvider('valheim', { games: ['valheim'], kinds: ['game_server'], ...over });
}

/** Counts every claim-status and onboarding GET for the subject hub (the control hub, id 9, always shows). */
const hits = { claim: 0, onboarding: 0 };
function serveStatus(subject: HubClaimStatus): void {
    server.use(
        http.get(`${API}/guilds/:id/claim`, ({ params }) => {
            if (Number(params['id']) === CONTROL_ID) return HttpResponse.json(buildHubClaimStatus());
            hits.claim += 1;
            return HttpResponse.json(subject);
        }),
        http.get(ONBOARDING, () => { hits.onboarding += 1; return HttpResponse.json({ dismissed: [] }); }),
    );
}

async function openListAndClaimThrall(): Promise<void> {
    await userEvent.click(await screen.findByRole('button', { name: 'Pick my character' }));
    await userEvent.click(within(await screen.findByTestId('hub-claim-candidates')).getByRole('button', { name: 'Claim Thrall' }));
}

beforeEach(() => {
    hits.claim = 0;
    hits.onboarding = 0;
    vi.mocked(toast.success).mockClear();
    usePluginStore.setState({ activeSlugs: new Set(['core', 'valheim']), initialized: true });
});
afterEach(() => { clearHubClaimProviders(); server.resetHandlers(); vi.restoreAllMocks(); });

describe('claim prompt — no provider (AC1)', () => {
    /** Settles once a query issued in the same render has completed, so any fetch the cell started is counted. */
    function Probe() {
        const { data } = useQuery({ queryKey: ['probe'], queryFn: async () => (await fetch(`${API}/__probe`)).json() as Promise<{ ok: boolean }> });
        return data?.ok === true ? <p>probed</p> : null;
    }

    it('a hub with no claim provider registered fetches nothing and renders nothing', async () => {
        serveStatus(buildHubClaimStatus());
        server.use(http.get(`${API}/__probe`, () => HttpResponse.json({ ok: true })));
        renderWithProviders(<><HubClaimPromptCell ctx={{ page: page() }} /><Probe /></>);
        expect(await screen.findByText('probed')).toBeInTheDocument();
        expect(screen.queryByTestId(PROMPT)).toBeNull();
        expect(hits).toEqual({ claim: 0, onboarding: 0 });
    });
});

describe('claim prompt — options required (fail closed)', () => {
    it('without an OptionsStep the hub is not offered and nothing is posted', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        register();
        const calls: HubClaimCall[] = [];
        serveStatus(buildHubClaimStatus({ claimOptions: 'wow_ruleset', candidates: [THRALL, JAINA], suggested: JAINA }));
        server.use(hubClaimPostHandler(buildHubClaimResult(), calls));
        renderWithProviders(<><HubClaimPromptCell ctx={{ page: page() }} /><HubClaimPromptCell ctx={{ page: page(CONTROL_ID) }} /></>);
        await waitFor(() => { expect(screen.queryAllByTestId(PROMPT).length).toBeGreaterThan(0); });
        expect(screen.getAllByTestId(PROMPT)).toHaveLength(1);
        expect(hits.claim).toBe(1);
        expect(calls).toEqual([]);
        await waitFor(() => { expect(logged).toHaveBeenCalledWith(expect.stringContaining('has no OptionsStep')); });
    });
});

describe('claim prompt — overlay state', () => {
    it('closing the overlay drops the options step: reopening shows the list', async () => {
        register({ OptionsStep: RulesetStep });
        serveStatus(buildHubClaimStatus({ claimOptions: 'wow_ruleset' }));
        renderWithProviders(<HubClaimPromptCell ctx={{ page: page() }} />);
        await openListAndClaimThrall();
        expect(await screen.findByRole('button', { name: 'Use Hardcore' })).toBeInTheDocument();
        await userEvent.keyboard('{Escape}');
        await waitFor(() => { expect(screen.queryByRole('button', { name: 'Use Hardcore' })).toBeNull(); });
        await userEvent.click(screen.getByRole('button', { name: 'Pick my character' }));
        expect(await screen.findByTestId('hub-claim-candidates')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Use Hardcore' })).toBeNull();
    });

    it('a failed claim shows its banner inside the open overlay, and closing clears it', async () => {
        register();
        serveStatus(buildHubClaimStatus());
        server.use(hubClaimErrorHandler('post', 'HUB_CLAIM_CANDIDATE_TAKEN'));
        renderWithProviders(<HubClaimPromptCell ctx={{ page: page() }} />);
        await openListAndClaimThrall();
        const dialog = await screen.findByRole('dialog');
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('Someone else just claimed that character. Pick another.');
        await userEvent.keyboard('{Escape}');
        await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
        expect(within(screen.getByTestId(PROMPT)).queryByRole('alert')).toBeNull();
    });

    it('reopening the list clears a card error from a one-click claim', async () => {
        register();
        serveStatus(buildHubClaimStatus({ candidates: [THRALL, JAINA], suggested: JAINA }));
        server.use(http.post(`${API}/guilds/:id/claim/:candidateId`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
        renderWithProviders(<HubClaimPromptCell ctx={{ page: page() }} />);
        await userEvent.click(await screen.findByRole('button', { name: 'Claim Jaina' }));
        expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't claim that character. Try again in a moment.");
        await userEvent.click(screen.getByRole('button', { name: 'Not me? Pick another' }));
        await screen.findByTestId('hub-claim-candidates');
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('claim prompt — dismiss toast', () => {
    it('a stored dismissal toasts the confirmation', async () => {
        register();
        serveStatus(buildHubClaimStatus());
        server.use(http.post(`${ONBOARDING}/:key/dismiss`, () => HttpResponse.json({
            dismissed: [{ key: 'claim-character', guildId: 7, dismissedAt: '2026-11-10T00:00:00.000Z' }],
        })));
        renderWithProviders(<HubClaimPromptCell ctx={{ page: page() }} />);
        await userEvent.click(await screen.findByRole('button', { name: "Dismiss: don't show this again" }));
        await waitFor(() => { expect(toast.success).toHaveBeenCalledWith("Got it. We won't show this again."); });
    });
});
