/**
 * ROK-2153 N4 — a provider that opts in with `scopedDismissal` (BG3: one round
 * per campaign) hides the prompt only for a dismissal of the CURRENT
 * `dismissScope`; a provider that does not opt in keeps "once per hub".
 *
 * Each case renders the subject (hub 7) beside a control hub (9) whose status
 * has no scope and no dismissal, so once the control shows the shared queries
 * have settled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildPage, HubClaimStatus, HubOnboardingDismissalDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { buildHubClaimStatus } from '../../../test/mocks/hub-claim-handlers';
import { usePluginStore } from '../../../stores/plugin-store';
import { addHubClaimProvider, clearHubClaimProviders } from './hub-claim-providers';
import { HubClaimPromptCell } from './hub-claim-prompt-cell';
import type { HubClaimShowing } from './hub-claim-prompt';

vi.mock('../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const API = 'http://localhost:3000';
const ONBOARDING = `${API}/guilds/onboarding`;
const PROMPT = 'hub-claim-prompt';
const SUBJECT_ID = 7;
const CONTROL_ID = 9;
const AT = '2026-11-01T00:00:00.000Z';

function page(id: number): GuildPage {
    return {
        guild: { id, gameId: 1, kind: 'game_community', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 1, lastSnapshotAt: null, gameSlug: 'baldurs-gate-3' },
        importedBy: null,
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

function register(scoped: boolean): void {
    addHubClaimProvider('bg3', { games: ['baldurs-gate-3'], kinds: ['game_community'], ...(scoped ? { scopedDismissal: true as const } : {}) });
}

function row(scope?: string): HubOnboardingDismissalDto {
    return { key: 'claim-character', guildId: SUBJECT_ID, ...(scope === undefined ? {} : { scope }), dismissedAt: AT };
}

let subjectHits = 0;
let dismissals: string[] = [];
function serve(subject: HubClaimStatus, dismissed: HubOnboardingDismissalDto[]): void {
    server.use(
        http.get(`${API}/guilds/:id/claim`, ({ params }) => {
            if (Number(params['id']) === CONTROL_ID) return HttpResponse.json(buildHubClaimStatus());
            subjectHits += 1;
            return HttpResponse.json(subject);
        }),
        http.get(ONBOARDING, () => HttpResponse.json({ dismissed })),
        http.post(`${ONBOARDING}/:key/dismiss`, ({ request, params }) => {
            dismissals.push(`${String(params['key'])}?${new URL(request.url).searchParams.toString()}`);
            return HttpResponse.json({ dismissed });
        }),
    );
}

function renderBoth(onSubjectShowing?: (state: HubClaimShowing) => void): void {
    renderWithProviders(<>
        <HubClaimPromptCell ctx={{ page: page(SUBJECT_ID) }} onShowingChange={onSubjectShowing} />
        <HubClaimPromptCell ctx={{ page: page(CONTROL_ID) }} />
    </>);
}

async function expectPrompts(count: number): Promise<void> {
    await waitFor(() => { expect(screen.queryAllByTestId(PROMPT)).toHaveLength(count); });
}

/**
 * The subject's card reports 'pending' until its dismissal and status queries
 * have settled, so waiting for 'hidden' (not for the status request to have
 * been made) proves the hidden state is the settled answer for this round.
 */
async function expectSubjectSettledHidden(): Promise<void> {
    const showing = vi.fn<(state: HubClaimShowing) => void>();
    renderBoth(showing);
    await waitFor(() => { expect(showing).toHaveBeenLastCalledWith('hidden'); });
    expect(showing).not.toHaveBeenCalledWith('showing');
    expect(subjectHits).toBe(1);
    await expectPrompts(1); // the control hub's card; the subject's stays absent
    expect(showing).toHaveBeenLastCalledWith('hidden');
}

beforeEach(() => {
    subjectHits = 0;
    dismissals = [];
    usePluginStore.setState({ activeSlugs: new Set(['core', 'bg3']), initialized: true });
});
afterEach(() => { clearHubClaimProviders(); server.resetHandlers(); });

describe('claim prompt — scoped dismissal (provider opted in)', () => {
    it('shows again when the status reports a new round the member has not dismissed', async () => {
        register(true);
        serve(buildHubClaimStatus({ dismissScope: 'campaign-2' }), [row('campaign-1')]);
        renderBoth();
        await expectPrompts(2);
    });

    it('stays hidden when the dismissal is for the current round', async () => {
        register(true);
        serve(buildHubClaimStatus({ dismissScope: 'campaign-2' }), [row('campaign-2')]);
        await expectSubjectSettledHidden();
    });

    it('an unscoped dismissal does not hide a scoped prompt', async () => {
        register(true);
        serve(buildHubClaimStatus({ dismissScope: 'campaign-2' }), [row()]);
        renderBoth();
        await expectPrompts(2);
    });

    it('a provider that reports no scope behaves as unscoped', async () => {
        register(true);
        serve(buildHubClaimStatus(), [row()]);
        await expectSubjectSettledHidden();
    });

    it('the × dismisses this round only (scope sent) and hides the card', async () => {
        register(true);
        serve(buildHubClaimStatus({ dismissScope: 'campaign-2' }), [row('campaign-1')]);
        renderWithProviders(<HubClaimPromptCell ctx={{ page: page(SUBJECT_ID) }} />);
        await userEvent.click(await screen.findByRole('button', { name: "Dismiss: don't show this again" }));
        await waitFor(() => { expect(screen.queryByTestId(PROMPT)).toBeNull(); });
        expect(dismissals).toEqual(['claim-character?guildId=7&scope=campaign-2']);
    });
});

describe('claim prompt — provider not opted in', () => {
    it('ignores a reported scope: the × sends no scope', async () => {
        register(false);
        serve(buildHubClaimStatus({ dismissScope: 'campaign-2' }), []);
        renderWithProviders(<HubClaimPromptCell ctx={{ page: page(SUBJECT_ID) }} />);
        await userEvent.click(await screen.findByRole('button', { name: "Dismiss: don't show this again" }));
        await waitFor(() => { expect(dismissals).toEqual(['claim-character?guildId=7']); });
    });

    it('an unscoped dismissal hides it without a status request, whatever round a scoped row names', async () => {
        register(false);
        serve(buildHubClaimStatus({ dismissScope: 'campaign-2' }), [row(), row('campaign-1')]);
        renderBoth();
        await expectPrompts(1);
        expect(subjectHits).toBe(0);
    });
});
