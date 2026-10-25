/** ROK-1953 W1–W6 — the Core Achievement race card: masking, viewer states, visibility. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../../test/render-helpers';
import { hubSteamStatsHandler, maskedUnlock, namedUnlock, steamMember, steamStatsResponse } from '../../../test/mocks/hub-steam-stats-handlers';
import SteamAchievementsWidget from './steam-achievements-widget';
import { STEAM_NOBODY_LINKED_COPY, STEAM_PRIVATE_COPY } from './steam-stats-viewer-callout';
import { useSteamAchievementsVisible, useSteamPlaytimeVisible } from './use-steam-stats-visible';
import { steamCtx } from './steam-stats.test-utils';

const linkSteam = vi.fn();
vi.mock('../../../hooks/use-steam-link', () => ({ useSteamLink: () => ({ linkSteam, isLinkPending: false }) }));

beforeEach(() => { linkSteam.mockReset(); });

async function renderCard(): Promise<HTMLElement> {
    const { container } = renderWithProviders(<SteamAchievementsWidget {...steamCtx()} />);
    await waitFor(() => expect(screen.queryByTestId('steam-stats-loading')).toBeNull());
    return container;
}

function probe(hook: typeof useSteamAchievementsVisible) {
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return renderHook(() => hook(steamCtx()), { wrapper });
}

describe('SteamAchievementsWidget — data', () => {
    it('ranks ok members as "X / Y" and leaves private/unlinked members to the footnote', async () => {
        server.use(hubSteamStatsHandler(steamStatsResponse()));
        await renderCard();
        const rows = screen.getAllByTestId('steam-race-row').map((r) => r.textContent);
        // Leading letter = the AvatarWithFallback initials (no avatar URL seeded).
        expect(rows).toEqual(['AAstarion Fan5 / 6', 'KKarlach Tav3 / 6']);
        expect(screen.getByRole('meter', { name: 'Astarion Fan: 5 of 6 achievements' })).toBeTruthy();
        expect(screen.getByTestId('steam-achievements-footnote').textContent)
            .toBe("1 hasn't linked Steam · 1 private. Steam counts unlocks per player, so co-op partners don't always get them. Updated 4 h ago.");
    });

    it('W1 — a masked unlock reads "Hidden achievement" + %, and no achievement name ever renders for it', async () => {
        server.use(hubSteamStatsHandler(steamStatsResponse()));
        const container = await renderCard();
        expect(screen.getAllByTestId('steam-masked-achievement').map((m) => m.textContent)).toEqual(['Hidden achievement', 'Hidden achievement']);
        expect(screen.getByText('Astarion Fan: Hidden achievement, 2.7% of players')).toBeTruthy();
        expect(screen.getByTestId('steam-rarest').textContent).toBe('Rarest: Hidden achievement · 2.7% — Astarion Fan');
        // The seeded hidden names (L3 seed) and any api name must be absent from the DOM.
        expect(container.textContent).not.toMatch(/Secret|DEMO_SECRET|title=/i);
        expect(container.querySelector('[title]')?.getAttribute('title')).toBe('Fewer than 10% of players have this');
        expect(screen.getByText('Descent From Avernus')).toBeTruthy();
    });

    it('marks rare unlocks (< 10%) with a neutral "Rare" chip only', async () => {
        server.use(hubSteamStatsHandler(steamStatsResponse()));
        await renderCard();
        const rare = screen.getAllByTestId('steam-unlock-row').map((r) => r.textContent?.includes('Rare'));
        expect(rare).toEqual([true, false, false]);
    });
});

describe('SteamAchievementsWidget — recent-unlock keys (Codex P2)', () => {
    it('two unlocks by one member in the same second render without a duplicate-key warning', async () => {
        const at = '2026-10-24T20:00:00.000Z';
        const recentUnlocks = [maskedUnlock(1, 2.7, at), maskedUnlock(1, 18.6, at), namedUnlock(1, 'Act One', 70, at)];
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        server.use(hubSteamStatsHandler(steamStatsResponse({ recentUnlocks })));
        await renderCard();
        const dupes = errors.mock.calls.map((c) => c.map(String).join(' ')).filter((m) => m.includes('same key'));
        errors.mockRestore();
        expect(dupes).toEqual([]);
        expect(screen.getAllByTestId('steam-unlock-row')).toHaveLength(3);
    });
});

describe('SteamAchievementsWidget — viewer states', () => {
    it('W2 — viewer unlinked: the list + "Link Steam to join the race." whose button calls linkSteam', async () => {
        server.use(hubSteamStatsHandler(steamStatsResponse({ viewer: { status: 'unlinked' } })));
        await renderCard();
        expect(screen.getAllByTestId('steam-race-row')).toHaveLength(2);
        expect(screen.getByTestId('steam-stats-callout').textContent).toContain('Link Steam to join the race.');
        fireEvent.click(screen.getByRole('button', { name: 'Link Steam' }));
        expect(linkSteam).toHaveBeenCalledTimes(1);
    });

    it('W3 — viewer private: warning copy, no button', async () => {
        server.use(hubSteamStatsHandler(steamStatsResponse({ viewer: { status: 'private' } })));
        await renderCard();
        const callout = screen.getByTestId('steam-stats-callout');
        expect(callout.textContent).toBe(STEAM_PRIVATE_COPY);
        expect(callout.className).toContain('text-warning');
        expect(screen.queryByRole('button', { name: 'Link Steam' })).toBeNull();
    });

    it('viewer pending: tonight’s-refresh line', async () => {
        server.use(hubSteamStatsHandler(steamStatsResponse({ viewer: { status: 'pending' } })));
        await renderCard();
        expect(screen.getByTestId('steam-stats-callout').textContent).toBe("Your Steam stats arrive with tonight's refresh.");
    });

    it('W4 — nobody linked: the §4.5 sentence, Link Steam only for an unlinked viewer', async () => {
        const members = [steamMember(1, { status: 'unlinked', unlockedCount: null }), steamMember(2, { status: 'unlinked', unlockedCount: null })];
        server.use(hubSteamStatsHandler(steamStatsResponse({ members, recentUnlocks: [], rarestUnlock: null, viewer: { status: 'unlinked' } })));
        await renderCard();
        expect(screen.getByTestId('steam-stats-empty').textContent).toContain(STEAM_NOBODY_LINKED_COPY);
        expect(screen.getByRole('button', { name: 'Link Steam' })).toBeTruthy();
        expect(screen.queryByTestId('steam-race-row')).toBeNull();
    });
});

describe('Steam cards — visibility (W5, W6)', () => {
    it('W5 — the route\'s 404 hides both cards', async () => {
        server.use(hubSteamStatsHandler({ available: false }, 404));
        const a = probe(useSteamAchievementsVisible);
        const p = probe(useSteamPlaytimeVisible);
        await waitFor(() => expect(a.result.current).toBe(false));
        expect(p.result.current).toBe(false);
    });

    it('W5 — `{ available: false }` hides both cards, and the body renders nothing', async () => {
        server.use(hubSteamStatsHandler({ available: false }));
        const p = probe(useSteamPlaytimeVisible);
        await waitFor(() => expect(p.result.current).toBe(false));
        const container = await renderCard();
        expect(container.textContent).toBe('');
    });

    it('W6 — a game with no achievements hides the race but keeps Playtime', async () => {
        server.use(hubSteamStatsHandler(steamStatsResponse({ totalAchievements: 0 })));
        const p = probe(useSteamPlaytimeVisible);
        await waitFor(() => expect(p.result.current).toBe(true));
        expect(probe(useSteamAchievementsVisible).result.current).toBe(false);
    });

    it('both show for an enabled game with achievements', async () => {
        server.use(hubSteamStatsHandler(steamStatsResponse()));
        const a = probe(useSteamAchievementsVisible);
        await waitFor(() => expect(a.result.current).toBe(true));
    });
});
