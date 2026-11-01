/**
 * ROK-2056 AC 3 / AC 9 — the hub Overview Companion prompt: shown to a member
 * of a hub whose active plugin registered a prompt for that game + kind, who is
 * not linked and has not dismissed it for THIS hub, while a download exists.
 * Uses the real BG3 + Blizzard registrations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { CompanionDevice, GuildPage, HubOnboardingStateDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { usePluginStore } from '../../../stores/plugin-store';
import type { HubCtx } from '../../../plugins/hub-module';
import '../../../plugins/bg3/register';
import '../../../plugins/wow/register';
import { gatedHubCompanionPrompt } from './hub-companion-prompts';
import { HubCompanionPromptCell } from './hub-companion-prompt-cell';

const flag = vi.hoisted(() => ({ on: true }));
vi.mock('../../../lib/companion-install', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../lib/companion-install')>()),
    companionDownloadAvailable: () => flag.on,
}));
vi.mock('../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const API = 'http://localhost:3000';
const DEVICES = `${API}/companion/v1/devices`;
const ONBOARDING = `${API}/guilds/onboarding`;
const DISMISS = `${ONBOARDING}/companion-install/dismiss`;
const PROMPT = 'companion-install-prompt';

interface PageOpts { gameSlug?: string; kind?: GuildPage['guild']['kind']; role?: GuildPage['viewer']['role'] }

function page({ gameSlug = 'baldurs-gate-3', kind = 'game_community', role = 'member' }: PageOpts = {}): GuildPage {
    return {
        guild: { id: 7, gameId: 1, kind, name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 1, lastSnapshotAt: null, gameSlug },
        importedBy: null,
        viewer: { role, canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

function device(state: CompanionDevice['state']): CompanionDevice {
    return {
        id: 1, name: 'PC', os: 'windows', osVersion: '11', appVersion: '0.1.0', tokenHint: 'ab12',
        createdAt: '2026-10-12T12:00:00.000Z', lastUsedAt: null, lastUsedNetwork: null,
        revokedAt: state === 'revoked' ? '2026-10-13T12:00:00.000Z' : null, state,
    };
}

let deviceHits = 0;
function serve(devices: CompanionDevice[] = [], onboarding: HubOnboardingStateDto = { dismissed: [] }): void {
    server.use(
        http.get(DEVICES, () => { deviceHits += 1; return HttpResponse.json({ data: devices }); }),
        http.get(ONBOARDING, () => HttpResponse.json(onboarding)),
    );
}

function renderCell(opts: PageOpts = {}): void {
    renderWithProviders(<HubCompanionPromptCell ctx={{ page: page(opts) } as HubCtx} />);
}

beforeEach(() => {
    flag.on = true;
    deviceHits = 0;
    usePluginStore.setState({ activeSlugs: new Set(['core', 'bg3', 'blizzard']), initialized: true });
});
afterEach(() => { server.resetHandlers(); });

describe('Companion prompt — shown (AC 3)', () => {
    it('member, not linked, not dismissed: BG3 copy (Q8), install link to the Companion card', async () => {
        serve();
        renderCell();
        const card = await screen.findByTestId(PROMPT);
        expect(screen.getByRole('heading', { name: 'Upload your saves automatically' })).toBeInTheDocument();
        expect(screen.getByTestId('companion-install-prompt-body')).toHaveTextContent('or upload saves from your browser.');
        expect(screen.getByRole('link', { name: 'Install the Companion' })).toHaveAttribute('href', '/profile/integrations#companion');
        expect(card).toHaveTextContent('Shown to members until you link a computer.');
    });

    it('a revoked-only device still counts as not linked', async () => {
        serve([device('revoked')]);
        renderCell();
        expect(await screen.findByTestId(PROMPT)).toBeInTheDocument();
    });

    it('a dismissal for ANOTHER hub does not hide it here', async () => {
        serve([], { dismissed: [{ key: 'companion-install', guildId: 8, dismissedAt: '2026-11-01T00:00:00.000Z' }] });
        renderCell();
        expect(await screen.findByTestId(PROMPT)).toBeInTheDocument();
    });
});

describe('Companion prompt — hidden', () => {
    it('when linked (an active device)', async () => {
        serve([device('active')]);
        renderCell();
        await waitFor(() => { expect(deviceHits).toBe(1); });
        await waitFor(() => { expect(screen.queryByTestId(PROMPT)).toBeNull(); });
    });

    it('when dismissed for this hub — and the device list is never fetched', async () => {
        let onboardingHits = 0;
        serve([], { dismissed: [{ key: 'companion-install', guildId: 7, dismissedAt: '2026-11-01T00:00:00.000Z' }] });
        server.use(http.get(ONBOARDING, () => {
            onboardingHits += 1;
            return HttpResponse.json({ dismissed: [{ key: 'companion-install', guildId: 7, dismissedAt: '2026-11-01T00:00:00.000Z' }] });
        }));
        renderCell();
        await waitFor(() => { expect(onboardingHits).toBe(1); });
        expect(screen.queryByTestId(PROMPT)).toBeNull();
        expect(deviceHits).toBe(0);
    });

    it.each([
        ['a visitor', { role: 'visitor' as const }],
        ['the wrong game', { gameSlug: 'valheim' }],
        ['the wrong hub kind', { kind: 'wow_guild' as const }],
    ])('for %s, without fetching anything', (_label, opts) => {
        serve();
        renderCell(opts);
        expect(screen.queryByTestId(PROMPT)).toBeNull();
        expect(deviceHits).toBe(0);
    });

    it('while the owning plugin is inactive', () => {
        usePluginStore.setState({ activeSlugs: new Set(['core', 'blizzard']), initialized: true });
        serve();
        renderCell();
        expect(screen.queryByTestId(PROMPT)).toBeNull();
        expect(deviceHits).toBe(0);
    });

    it('while no public download exists (AC 9)', () => {
        flag.on = false;
        serve();
        renderCell();
        expect(screen.queryByTestId(PROMPT)).toBeNull();
        expect(deviceHits).toBe(0);
    });
});

describe('Companion prompt — dismiss', () => {
    it('"Not now" stores a per-hub dismissal and hides the card', async () => {
        serve();
        let scope: string | null = null;
        server.use(http.post(DISMISS, ({ request }) => {
            scope = new URL(request.url).searchParams.get('guildId');
            return HttpResponse.json({ dismissed: [{ key: 'companion-install', guildId: 7, dismissedAt: '2026-11-01T00:00:00.000Z' }] });
        }));
        renderCell();
        await userEvent.click(await screen.findByTestId('companion-install-prompt-dismiss'));
        await waitFor(() => { expect(screen.queryByTestId(PROMPT)).toBeNull(); });
        expect(scope).toBe('7');
    });

    it('a failed dismiss brings the card back with an alert line', async () => {
        serve();
        server.use(http.post(DISMISS, () => HttpResponse.json({ message: 'nope' }, { status: 500 })));
        renderCell();
        await userEvent.click(await screen.findByTestId('companion-install-prompt-close'));
        expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't dismiss that just now.");
        expect(screen.getByTestId(PROMPT)).toBeInTheDocument();
    });
});

describe('Companion prompt registrations', () => {
    const active = new Set(['core', 'bg3', 'blizzard']);
    it('BG3 on game_community hubs of either BG3 slug; Blizzard on Forever wow_guild hubs', () => {
        expect(gatedHubCompanionPrompt(page(), active)?.pluginSlug).toBe('bg3');
        expect(gatedHubCompanionPrompt(page({ gameSlug: 'baldurs-gate-iii' }), active)?.prompt.requirementId).toBe('upload-saves');
        const wow = gatedHubCompanionPrompt(page({ gameSlug: 'world-of-warcraft-forever', kind: 'wow_guild' }), active);
        expect(wow?.prompt.requirementId).toBe('ledgerlink-companion');
        expect(gatedHubCompanionPrompt(page({ gameSlug: 'world-of-warcraft-forever', kind: 'game_community' }), active)).toBeUndefined();
    });
});
