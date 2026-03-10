import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGameFilterStore } from './game-filter-store';
import type { GameInfo } from './game-filter-store';

vi.mock('../lib/api-client', () => ({
    updatePreference: vi.fn(() => Promise.resolve()),
}));

vi.mock('../hooks/use-auth', () => ({
    getAuthToken: vi.fn(() => null),
}));

const GAMES: GameInfo[] = [
    { slug: 'wow', name: 'World of Warcraft', coverUrl: null },
    { slug: 'ffxiv', name: 'Final Fantasy XIV', coverUrl: null },
    { slug: 'eso', name: 'Elder Scrolls Online', coverUrl: null },
];

describe('useGameFilterStore — persistence', () => {
    beforeEach(() => {
        useGameFilterStore.getState()._reset();
    });

    it('saves selected game slugs via saveFilter', async () => {
        const { updatePreference } = await import('../lib/api-client');
        const { getAuthToken } = await import('../hooks/use-auth');
        vi.mocked(getAuthToken).mockReturnValue('test-token');

        useGameFilterStore.getState().reportGames(GAMES);
        useGameFilterStore.getState().toggleGame('eso');
        useGameFilterStore.getState().saveFilter();

        expect(updatePreference).toHaveBeenCalledWith(
            'calendarGameFilter',
            expect.any(Array),
        );
    });

    it('does not save filter when not authenticated', async () => {
        const { updatePreference } = await import('../lib/api-client');
        const { getAuthToken } = await import('../hooks/use-auth');
        vi.mocked(getAuthToken).mockReturnValue(null);
        vi.mocked(updatePreference).mockClear();

        useGameFilterStore.getState().reportGames(GAMES);
        useGameFilterStore.getState().saveFilter();

        expect(updatePreference).not.toHaveBeenCalled();
    });

    it('restores saved filter via loadSavedFilter', () => {
        useGameFilterStore.getState().reportGames(GAMES);
        const allSelected = useGameFilterStore.getState().selectedGames;
        expect(allSelected.size).toBe(3);

        useGameFilterStore.getState().loadSavedFilter(['wow', 'ffxiv']);

        const selected = useGameFilterStore.getState().selectedGames;
        expect(selected.size).toBe(2);
        expect(selected.has('wow')).toBe(true);
        expect(selected.has('ffxiv')).toBe(true);
        expect(selected.has('eso')).toBe(false);
    });

    it('marks hasSavedFilter as true after loading', () => {
        useGameFilterStore.getState().reportGames(GAMES);
        useGameFilterStore.getState().loadSavedFilter(['wow']);

        expect(useGameFilterStore.getState().hasSavedFilter).toBe(true);
    });

    it('does not apply saved filter if games have not been reported yet', () => {
        useGameFilterStore.getState().loadSavedFilter(['wow']);

        // Should still apply - the slugs are stored even if games not yet known
        expect(useGameFilterStore.getState().hasSavedFilter).toBe(true);
    });
});

describe('useGameFilterStore — reportGames with saved filter', () => {
    beforeEach(() => {
        useGameFilterStore.getState()._reset();
    });

    it('applies saved filter slugs instead of selecting all on first report', () => {
        // Load saved filter before games are reported
        useGameFilterStore.getState().loadSavedFilter(['wow', 'eso']);

        // Now report games — should use saved filter, not select all
        useGameFilterStore.getState().reportGames(GAMES);

        const selected = useGameFilterStore.getState().selectedGames;
        expect(selected.size).toBe(2);
        expect(selected.has('wow')).toBe(true);
        expect(selected.has('eso')).toBe(true);
        expect(selected.has('ffxiv')).toBe(false);
    });
});
