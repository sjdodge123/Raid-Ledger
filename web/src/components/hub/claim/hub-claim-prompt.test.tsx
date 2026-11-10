/**
 * ROK-2153 S3b — the core claim prompt on the hub Overview. No real plugin
 * registers a claim provider in this PR, so every test registers a fake one
 * through the registry (`addHubClaimProvider`) and serves the S3a MSW status.
 *
 * Status-driven hides render the subject beside a control hub (id 9) that
 * passes every gate: once the control shows, the shared queries have settled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildPage, HubClaimStatus, HubOnboardingStateDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    buildHubClaimCandidate, buildHubClaimResult, buildHubClaimStatus, hubClaimErrorHandler, hubClaimPostHandler, type HubClaimCall,
} from '../../../test/mocks/hub-claim-handlers';
import { usePluginStore } from '../../../stores/plugin-store';
import { addHubClaimProvider, clearHubClaimProviders, gatedHubClaimProvider, type HubClaimOptionsStepProps, type HubClaimProvider } from './hub-claim-providers';
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

interface PageOpts { id?: number; gameSlug?: string; kind?: GuildPage['guild']['kind'] }

function page({ id = 7, gameSlug = 'valheim', kind = 'game_server' }: PageOpts = {}): GuildPage {
    return {
        guild: { id, gameId: 1, kind, name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 1, lastSnapshotAt: null, gameSlug },
        importedBy: null,
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

const THRALL = buildHubClaimCandidate();
const JAINA = buildHubClaimCandidate({ id: 'c-2', name: 'Jaina', subtitle: null, match: 'strong', matchReason: 'steam_link' });

function register(over: Partial<HubClaimProvider> = {}): void {
    addHubClaimProvider('valheim', { games: ['valheim'], kinds: ['game_server'], ...over });
}

/** GET status per hub id (the control hub always gets a showing status); counts subject hits. */
let subjectHits = 0;
function serveStatus(subject: HubClaimStatus | null, onboarding: HubOnboardingStateDto = { dismissed: [] }): void {
    server.use(
        http.get(`${API}/guilds/:id/claim`, ({ params }) => {
            if (Number(params['id']) === CONTROL_ID) return HttpResponse.json(buildHubClaimStatus());
            subjectHits += 1;
            return subject === null ? HttpResponse.json({ statusCode: 404 }, { status: 404 }) : HttpResponse.json(subject);
        }),
        http.get(ONBOARDING, () => HttpResponse.json(onboarding)),
    );
}

function renderCell(opts: PageOpts = {}): void {
    renderWithProviders(<HubClaimPromptCell ctx={{ page: page(opts) }} />);
}

function renderWithControl(opts: PageOpts = {}): void {
    renderWithProviders(<>
        <HubClaimPromptCell ctx={{ page: page(opts) }} />
        <HubClaimPromptCell ctx={{ page: page({ id: CONTROL_ID }) }} />
    </>);
}

async function expectOnlyControl(): Promise<void> {
    await waitFor(() => { expect(screen.queryAllByTestId(PROMPT).length).toBeGreaterThan(0); });
    expect(screen.getAllByTestId(PROMPT)).toHaveLength(1);
}

beforeEach(() => {
    subjectHits = 0;
    usePluginStore.setState({ activeSlugs: new Set(['core', 'valheim']), initialized: true });
});
afterEach(() => { clearHubClaimProviders(); server.resetHandlers(); });

describe('claim prompt — provider gating', () => {
    it('shows for a member with no claim and something unclaimed, with the default copy', async () => {
        register();
        serveStatus(buildHubClaimStatus());
        renderCell();
        const card = await screen.findByTestId(PROMPT);
        expect(card).toHaveAccessibleName('Claim your character');
        expect(within(card).getByRole('heading', { name: 'Claim your character' })).toBeInTheDocument();
        expect(within(card).getByRole('button', { name: 'Pick my character' })).toBeInTheDocument();
    });

    it('renders nothing, synchronously, when no provider is registered', () => {
        serveStatus(buildHubClaimStatus());
        const { container } = renderWithProviders(<HubClaimPromptCell ctx={{ page: page() }} />);
        expect(gatedHubClaimProvider(page(), new Set(['core', 'valheim']))).toBeUndefined();
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing, synchronously, while the owning plugin is inactive', () => {
        register();
        usePluginStore.setState({ activeSlugs: new Set(['core']) });
        serveStatus(buildHubClaimStatus());
        const { container } = renderWithProviders(<HubClaimPromptCell ctx={{ page: page() }} />);
        expect(gatedHubClaimProvider(page(), new Set(['core']))).toBeUndefined();
        expect(gatedHubClaimProvider(page(), new Set(['core', 'valheim']))?.pluginSlug).toBe('valheim');
        expect(container).toBeEmptyDOMElement();
    });

    it.each([
        ['the wrong game', { gameSlug: 'baldurs-gate-3' }],
        ['the wrong hub kind', { kind: 'game_community' as const }],
    ])('renders nothing and fetches nothing for %s (beside a hub that shows it)', async (_label, opts) => {
        register();
        serveStatus(buildHubClaimStatus());
        renderWithControl(opts);
        await expectOnlyControl();
        expect(subjectHits).toBe(0);
    });

});

describe('claim prompt — status and dismissal gating', () => {
    it.each([
        ['the viewer is not a member', buildHubClaimStatus({ viewerIsMember: false })],
        ['the viewer already has a claim', buildHubClaimStatus({ viewerHasClaim: true })],
        ['nothing is left to claim', buildHubClaimStatus({ candidates: [] })],
    ])('hides when %s (beside a hub that shows it)', async (_label, status) => {
        register();
        serveStatus(status);
        renderWithControl();
        await expectOnlyControl();
        expect(subjectHits).toBe(1);
    });

    it('hides when the provider answers 404', async () => {
        register();
        serveStatus(null);
        renderWithControl();
        await expectOnlyControl();
    });

    it('hides when dismissed for this hub, without fetching its status', async () => {
        register();
        serveStatus(buildHubClaimStatus(), { dismissed: [{ key: 'claim-character', guildId: 7, dismissedAt: '2026-11-01T00:00:00.000Z' }] });
        renderWithControl();
        await expectOnlyControl();
        expect(subjectHits).toBe(0);
    });

    it('a dismissal for another hub or another prompt does not hide it here', async () => {
        register();
        serveStatus(buildHubClaimStatus(), { dismissed: [
            { key: 'claim-character', guildId: 8, dismissedAt: '2026-11-01T00:00:00.000Z' },
            { key: 'companion-install', guildId: 7, dismissedAt: '2026-11-01T00:00:00.000Z' },
        ] });
        renderCell();
        expect(await screen.findByTestId(PROMPT)).toBeInTheDocument();
    });

    it('uses the provider copy override', async () => {
        register({ copy: { heading: 'Playing on Midgard?', body: 'Pick your viking.', cta: 'Find my viking' } });
        serveStatus(buildHubClaimStatus());
        renderCell();
        expect(await screen.findByRole('heading', { name: 'Playing on Midgard?' })).toBeInTheDocument();
        expect(screen.getByTestId('hub-claim-prompt-body')).toHaveTextContent('Pick your viking.');
        expect(screen.getByRole('button', { name: 'Find my viking' })).toBeInTheDocument();
    });
});

describe('claim prompt — claiming', () => {
    it('one click claims the suggested match', async () => {
        register();
        const calls: HubClaimCall[] = [];
        serveStatus(buildHubClaimStatus({ candidates: [THRALL, JAINA], suggested: JAINA }));
        server.use(hubClaimPostHandler(buildHubClaimResult({ claimed: JAINA }), calls));
        renderCell();
        const card = await screen.findByTestId(PROMPT);
        expect(within(card).getByTestId('hub-claim-suggested')).toHaveTextContent('Jaina');
        await userEvent.click(within(card).getByRole('button', { name: 'Claim Jaina' }));
        await waitFor(() => { expect(calls).toEqual([{ hubId: 7, candidateId: 'c-2', body: {} }]); });
    });

    it('"Not me? Pick another" opens the list, and a row claims that candidate', async () => {
        register();
        const calls: HubClaimCall[] = [];
        serveStatus(buildHubClaimStatus({ candidates: [THRALL, JAINA], suggested: JAINA }));
        server.use(hubClaimPostHandler(buildHubClaimResult(), calls));
        renderCell();
        await userEvent.click(await screen.findByRole('button', { name: 'Not me? Pick another' }));
        const list = await screen.findByTestId('hub-claim-candidates');
        await userEvent.click(within(list).getByRole('button', { name: 'Claim Thrall' }));
        await waitFor(() => { expect(calls).toEqual([{ hubId: 7, candidateId: 'c-1', body: {} }]); });
    });

    it('a lost race (409 taken) shows an inline warning banner and refetches the status', async () => {
        register();
        serveStatus(buildHubClaimStatus({ candidates: [THRALL, JAINA], suggested: JAINA }));
        server.use(hubClaimErrorHandler('post', 'HUB_CLAIM_CANDIDATE_TAKEN'));
        renderCell();
        await userEvent.click(await screen.findByRole('button', { name: 'Claim Jaina' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Someone else just claimed that character. Pick another.');
        await waitFor(() => { expect(subjectHits).toBe(2); });
    });

    it('runs the provider options step before the claim and posts its options', async () => {
        function RulesetStep({ onSubmit }: HubClaimOptionsStepProps) {
            return <button type="button" onClick={() => { onSubmit({ ruleset: 'hardcore' }); }}>Use Hardcore</button>;
        }
        register({ OptionsStep: RulesetStep });
        const calls: HubClaimCall[] = [];
        serveStatus(buildHubClaimStatus({ claimOptions: 'wow_ruleset' }));
        server.use(hubClaimPostHandler(buildHubClaimResult(), calls));
        renderCell();
        await userEvent.click(await screen.findByRole('button', { name: 'Pick my character' }));
        await userEvent.click(within(await screen.findByTestId('hub-claim-candidates')).getByRole('button', { name: 'Claim Thrall' }));
        expect(calls).toEqual([]);
        await userEvent.click(await screen.findByRole('button', { name: 'Use Hardcore' }));
        await waitFor(() => { expect(calls).toEqual([{ hubId: 7, candidateId: 'c-1', body: { options: { ruleset: 'hardcore' } } }]); });
    });
});

describe('claim prompt — dismissal', () => {
    it('the × stores claim-character for this hub and hides the card', async () => {
        register();
        serveStatus(buildHubClaimStatus());
        const dismissals: string[] = [];
        server.use(http.post(`${ONBOARDING}/:key/dismiss`, ({ request, params }) => {
            dismissals.push(`${String(params['key'])}?${new URL(request.url).searchParams.toString()}`);
            return HttpResponse.json({ dismissed: [{ key: 'claim-character', guildId: 7, dismissedAt: '2026-11-10T00:00:00.000Z' }] });
        }));
        renderCell();
        await userEvent.click(await screen.findByRole('button', { name: "Dismiss: don't show this again" }));
        await waitFor(() => { expect(screen.queryByTestId(PROMPT)).toBeNull(); });
        expect(dismissals).toEqual(['claim-character?guildId=7']);
    });

    it('a failed dismissal brings the card back with an alert', async () => {
        register();
        serveStatus(buildHubClaimStatus());
        server.use(http.post(`${ONBOARDING}/:key/dismiss`, () => HttpResponse.json({ message: 'nope' }, { status: 500 })));
        renderCell();
        await userEvent.click(await screen.findByRole('button', { name: "Dismiss: don't show this again" }));
        expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't dismiss that just now.");
        expect(screen.getByTestId(PROMPT)).toBeInTheDocument();
    });
});
