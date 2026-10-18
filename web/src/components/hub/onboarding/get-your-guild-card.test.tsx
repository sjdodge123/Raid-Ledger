/**
 * ROK-1830 S5b — the Players-page "get your guild" card: shown to a signed-in
 * viewer with no hub, gone once dismissed, and never shown to a viewer who
 * already has one (the WoW slot renders their guild cards instead).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { HubOnboardingStateDto, MyGuilds } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { toast } from '../../../lib/toast';
import { renderWithProviders } from '../../../test/render-helpers';
import { GetYourGuildCard } from './get-your-guild-card';
import { PlayersGuildCard } from '../../../plugins/wow/slots/players-guild-card';

vi.mock('../../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const URL = 'http://localhost:3000/guilds/onboarding';
const MINE = 'http://localhost:3000/plugins/wow/guilds/mine';
const EMPTY: HubOnboardingStateDto = { dismissed: [] };

function serveOnboarding(state: HubOnboardingStateDto = EMPTY): void {
    server.use(http.get(URL, () => HttpResponse.json(state)));
}

describe('GetYourGuildCard', () => {
    beforeEach(() => { vi.mocked(toast.success).mockClear(); });

    // ROK-1840 r2 gap 2: the prototype's pitch is the LedgerLink export, not a
    // generic "a guild page gives your roster one place…" line.
    it('pitches the LedgerLink export in the prototype\'s words', async () => {
        serveOnboarding();
        renderWithProviders(<GetYourGuildCard />);
        const card = await screen.findByTestId('get-your-guild-card');
        expect(card).toHaveTextContent(
            'Playing WoW with a guild? Export it from the game with the LedgerLink addon and import it here. '
            + 'Your guildmates get a shared page for raids, attendance and the leader post.',
        );
    });

    // ROK-1840: the S0 prototype folds the how-to behind a primary toggle
    // rather than showing it inline.
    it('shows the pitch, and the module how-to only once the steps are expanded', async () => {
        serveOnboarding();
        renderWithProviders(<GetYourGuildCard how="Install LedgerLink." />);
        await screen.findByTestId('get-your-guild-card');
        expect(screen.getByRole('heading', { name: 'Get your guild on Raid Ledger' })).toBeInTheDocument();
        expect(screen.queryByTestId('get-your-guild-how')).not.toBeInTheDocument();
        const toggle = screen.getByTestId('get-your-guild-how-toggle');
        expect(toggle).toHaveTextContent('How to import');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await userEvent.click(toggle);
        const panel = screen.getByTestId('get-your-guild-how');
        expect(panel).toHaveTextContent('Install LedgerLink.');
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(toggle).toHaveTextContent('Hide steps');
        // Codex P3 / review MINOR-2: the toggle owns the panel, and the panel
        // follows it, so forward navigation from the button reaches the steps.
        expect(toggle).toHaveAttribute('aria-controls', panel.id);
        expect(panel.id).toBe('get-your-guild-how-panel');
        expect(toggle.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    // ROK-1840 r1: the prototype draws the display rule inside the card, and
    // labels the x with the same "Not now" the sibling button shows — one
    // permanent dismissal, one name.
    it('carries the prototype footnote, and the x shares "Not now" as its name', async () => {
        serveOnboarding();
        renderWithProviders(<GetYourGuildCard how="Install LedgerLink." />);
        await screen.findByTestId('get-your-guild-card');
        expect(screen.getByTestId('get-your-guild-note'))
            .toHaveTextContent('Shown once, to signed-in players who are not in a guild yet.');
        expect(screen.getByTestId('get-your-guild-close')).toHaveAttribute('aria-label', "Dismiss: don't show this again");
    });

    it('offers no how-to toggle when the module supplies no steps', async () => {
        serveOnboarding();
        renderWithProviders(<GetYourGuildCard />);
        await screen.findByTestId('get-your-guild-card');
        expect(screen.queryByTestId('get-your-guild-how-toggle')).not.toBeInTheDocument();
    });

    it('"Not now" takes the card off the page', async () => {
        serveOnboarding();
        server.use(http.post(`${URL}/players-get-your-guild/dismiss`, () => HttpResponse.json({
            dismissed: [{ key: 'players-get-your-guild', guildId: null, dismissedAt: '2026-10-02T00:00:00.000Z' }],
        } satisfies HubOnboardingStateDto)));
        renderWithProviders(<GetYourGuildCard />);
        await userEvent.click(await screen.findByTestId('get-your-guild-dismiss'));
        await waitFor(() => expect(screen.queryByTestId('get-your-guild-card')).not.toBeInTheDocument());
        // ROK-1840 r2 gap 5: the prototype flashes a toast on dismissal, once.
        expect(vi.mocked(toast.success).mock.calls).toEqual([["Got it. We won't show this again."]]);
    });

    // Prototype parity: the × and "Not now" fire the SAME server-side
    // dismissal — the approved target shows no softer session-only hide.
    it('the × dismisses it the same way "Not now" does', async () => {
        serveOnboarding();
        let posted = 0;
        server.use(http.post(`${URL}/players-get-your-guild/dismiss`, () => {
            posted += 1;
            return HttpResponse.json({
                dismissed: [{ key: 'players-get-your-guild', guildId: null, dismissedAt: '2026-10-02T00:00:00.000Z' }],
            } satisfies HubOnboardingStateDto);
        }));
        renderWithProviders(<GetYourGuildCard />);
        await userEvent.click(await screen.findByTestId('get-your-guild-close'));
        await waitFor(() => expect(screen.queryByTestId('get-your-guild-card')).not.toBeInTheDocument());
        expect(posted).toBe(1);
        expect(vi.mocked(toast.success).mock.calls).toEqual([["Got it. We won't show this again."]]);
    });

    // ROK-1840 r3 (Codex P2): the hide is optimistic, so the toast must wait
    // for the stored write — on the old code it fired on the click.
    it('toasts only once the server has stored the dismissal', async () => {
        serveOnboarding();
        let release!: () => void;
        const stored = new Promise<void>((resolve) => { release = resolve; });
        server.use(http.post(`${URL}/players-get-your-guild/dismiss`, async () => {
            await stored;
            return HttpResponse.json({
                dismissed: [{ key: 'players-get-your-guild', guildId: null, dismissedAt: '2026-10-02T00:00:00.000Z' }],
            } satisfies HubOnboardingStateDto);
        }));
        renderWithProviders(<GetYourGuildCard />);
        await userEvent.click(await screen.findByTestId('get-your-guild-dismiss'));
        await waitFor(() => expect(screen.queryByTestId('get-your-guild-card')).not.toBeInTheDocument());
        expect(vi.mocked(toast.success).mock.calls).toEqual([]);
        release();
        await waitFor(() => {
            expect(vi.mocked(toast.success).mock.calls).toEqual([["Got it. We won't show this again."]]);
        });
    });

    // The other half of the same gate: a rejected dismissal rolls the card
    // back, so it must promise nothing at all.
    it('a rejected dismissal brings the card back and never toasts', async () => {
        serveOnboarding();
        server.use(http.post(`${URL}/players-get-your-guild/dismiss`, () => new HttpResponse(null, { status: 500 })));
        renderWithProviders(<GetYourGuildCard />);
        await userEvent.click(await screen.findByTestId('get-your-guild-dismiss'));
        await screen.findByTestId('get-your-guild-error');
        expect(screen.getByTestId('get-your-guild-card')).toBeInTheDocument();
        expect(vi.mocked(toast.success).mock.calls).toEqual([]);
    });

    it('a stored dismissal means it never appears', async () => {
        serveOnboarding({ dismissed: [{ key: 'players-get-your-guild', guildId: null, dismissedAt: '2026-10-01T00:00:00.000Z' }] });
        renderWithProviders(<GetYourGuildCard />);
        await waitFor(() => expect(screen.queryByTestId('get-your-guild-card')).not.toBeInTheDocument());
    });
});

describe('PlayersGuildCard', () => {
    it('a viewer with a hub gets their guild card, not the prompt', async () => {
        serveOnboarding();
        server.use(http.get(MINE, () => HttpResponse.json({
            guilds: [{
                id: 11, gameId: 1, kind: 'wow_guild', name: 'Iron Vanguard', region: 'us', realmSlug: null, realmName: 'Doomhowl',
                faction: 'Horde', memberCount: 12, lastSnapshotAt: null, rankIndex: 0, rankName: 'GM', canEdit: true, gmPostHeadline: null,
            }],
        } satisfies MyGuilds)));
        renderWithProviders(<PlayersGuildCard />);
        await screen.findByTestId('players-guild-card');
        expect(screen.queryByTestId('get-your-guild-card')).not.toBeInTheDocument();
    });

    it('a viewer with no hub gets the prompt where the cards would be', async () => {
        serveOnboarding();
        server.use(http.get(MINE, () => HttpResponse.json({ guilds: [] } satisfies MyGuilds)));
        renderWithProviders(<PlayersGuildCard />);
        await screen.findByTestId('get-your-guild-card');
    });

    // ROK-1840 r2 gap 3: step 3 names where the paste goes, as the prototype
    // words it — "Paste it here" left the destination out.
    it('the WoW how-to sends the export to Guilds → Import guild', async () => {
        serveOnboarding();
        server.use(http.get(MINE, () => HttpResponse.json({ guilds: [] } satisfies MyGuilds)));
        renderWithProviders(<PlayersGuildCard />);
        await userEvent.click(await screen.findByTestId('get-your-guild-how-toggle'));
        expect(screen.getByTestId('players-guild-how-steps')).toHaveTextContent(
            'Paste it under Guilds → Import guild here. Your roster, ranks and raid schedule come with it.',
        );
    });
});
