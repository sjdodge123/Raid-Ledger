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

describe('useGameFilterStore — saved filter edge cases', () => {
    beforeEach(() => {
        useGameFilterStore.getState()._reset();
        vi.clearAllMocks();
    });

    it('loadSavedFilter with stale slugs falls back to select all', () => {
        useGameFilterStore.getState().reportGames(GAMES);
        useGameFilterStore.getState().loadSavedFilter(['deleted-game', 'also-gone']);

        const selected = useGameFilterStore.getState().selectedGames;
        // Falls back to all known games when no saved slugs match
        expect(selected.size).toBe(3);
    });

    it('loadSavedFilter with empty array falls back to select all', () => {
        useGameFilterStore.getState().reportGames(GAMES);
        expect(useGameFilterStore.getState().selectedGames.size).toBe(3);

        useGameFilterStore.getState().loadSavedFilter([]);

        expect(useGameFilterStore.getState().selectedGames.size).toBe(3);
        expect(useGameFilterStore.getState().hasSavedFilter).toBe(true);
    });

    it('loadSavedFilter called multiple times uses the latest value', () => {
        useGameFilterStore.getState().reportGames(GAMES);

        useGameFilterStore.getState().loadSavedFilter(['wow']);
        expect(useGameFilterStore.getState().selectedGames.size).toBe(1);

        useGameFilterStore.getState().loadSavedFilter(['wow', 'ffxiv', 'eso']);
        expect(useGameFilterStore.getState().selectedGames.size).toBe(3);
    });

    it('savedFilterSlugs applied on first reportGames when loaded before games', () => {
        // Simulate: preferences load before game registry
        useGameFilterStore.getState().loadSavedFilter(['wow']);

        expect(useGameFilterStore.getState().hasInitialized).toBe(false);
        expect(useGameFilterStore.getState().savedFilterSlugs).toEqual(['wow']);

        useGameFilterStore.getState().reportGames(GAMES);

        const selected = useGameFilterStore.getState().selectedGames;
        expect(selected.size).toBe(1);
        expect(selected.has('wow')).toBe(true);
        expect(selected.has('ffxiv')).toBe(false);
    });

    it('_reset clears saved filter state', () => {
        useGameFilterStore.getState().reportGames(GAMES);
        useGameFilterStore.getState().loadSavedFilter(['wow']);

        expect(useGameFilterStore.getState().hasSavedFilter).toBe(true);

        useGameFilterStore.getState()._reset();

        expect(useGameFilterStore.getState().hasSavedFilter).toBe(false);
        expect(useGameFilterStore.getState().savedFilterSlugs).toBeNull();
        expect(useGameFilterStore.getState().selectedGames.size).toBe(0);
        expect(useGameFilterStore.getState().hasInitialized).toBe(false);
    });

    it('toggleGame works correctly after loadSavedFilter', () => {
        useGameFilterStore.getState().reportGames(GAMES);
        useGameFilterStore.getState().loadSavedFilter(['wow', 'ffxiv']);

        useGameFilterStore.getState().toggleGame('wow');

        const selected = useGameFilterStore.getState().selectedGames;
        expect(selected.has('wow')).toBe(false);
        expect(selected.has('ffxiv')).toBe(true);
        expect(selected.size).toBe(1);
    });

    it('selectAll overrides a previously loaded saved filter', () => {
        useGameFilterStore.getState().reportGames(GAMES);
        useGameFilterStore.getState().loadSavedFilter(['wow']);
        expect(useGameFilterStore.getState().selectedGames.size).toBe(1);

        useGameFilterStore.getState().selectAll();
        expect(useGameFilterStore.getState().selectedGames.size).toBe(3);
    });

    it('deselectAll overrides a previously loaded saved filter', () => {
        useGameFilterStore.getState().reportGames(GAMES);
        useGameFilterStore.getState().loadSavedFilter(['wow', 'ffxiv']);

        useGameFilterStore.getState().deselectAll();
        expect(useGameFilterStore.getState().selectedGames.size).toBe(0);
    });

    it('saveFilter sends empty array when nothing is selected', async () => {
        const { updatePreference } = await import('../lib/api-client');
        const { getAuthToken } = await import('../hooks/use-auth');
        vi.mocked(getAuthToken).mockReturnValue('test-token');

        useGameFilterStore.getState().reportGames(GAMES);
        useGameFilterStore.getState().deselectAll();
        useGameFilterStore.getState().saveFilter();

        expect(updatePreference).toHaveBeenCalledWith(
            'calendarGameFilter',
            [],
        );
    });

    it('saveFilter silently handles API rejection', async () => {
        const { updatePreference } = await import('../lib/api-client');
        const { getAuthToken } = await import('../hooks/use-auth');
        vi.mocked(getAuthToken).mockReturnValue('test-token');
        vi.mocked(updatePreference).mockRejectedValueOnce(new Error('Network error'));

        useGameFilterStore.getState().reportGames(GAMES);

        // Should not throw
        expect(() => useGameFilterStore.getState().saveFilter()).not.toThrow();
    });

    it('new games reported after saved filter do not auto-select', () => {
        // Load saved filter with just 'wow', then report games
        useGameFilterStore.getState().loadSavedFilter(['wow']);
        useGameFilterStore.getState().reportGames(GAMES);

        expect(useGameFilterStore.getState().selectedGames.size).toBe(1);

        // Report a new game that was not in the saved filter
        const newGame: GameInfo = { slug: 'gw2', name: 'Guild Wars 2', coverUrl: null };
        useGameFilterStore.getState().reportGames([...GAMES, newGame]);

        // New game should NOT be auto-selected since we have a saved filter
        expect(useGameFilterStore.getState().allKnownGames).toHaveLength(4);
        // Selection should remain as loaded — only 'wow'
        expect(useGameFilterStore.getState().selectedGames.has('gw2')).toBe(false);
    });
});

describe('useGameFilterStore — reportGames edge cases', () => {
    beforeEach(() => {
        useGameFilterStore.getState()._reset();
    });

    it('reportGames with empty array does not initialize', () => {
        useGameFilterStore.getState().reportGames([]);
        expect(useGameFilterStore.getState().hasInitialized).toBe(false);
    });

    it('reportGames deduplicates by slug (same slug is not double-counted)', () => {
        const gamesV1: GameInfo[] = [
            { slug: 'wow', name: 'WoW', coverUrl: null },
        ];
        useGameFilterStore.getState().reportGames(gamesV1);
        useGameFilterStore.getState().reportGames(gamesV1);

        const known = useGameFilterStore.getState().allKnownGames;
        expect(known).toHaveLength(1);
        expect(known[0].slug).toBe('wow');
    });

    it('reportGames with mixed new and existing slugs only adds new ones to selection', () => {
        useGameFilterStore.getState().reportGames([makeGame('wow', 'WoW')]);
        useGameFilterStore.getState().toggleGame('wow'); // deselect wow

        // Report wow again + a new game
        useGameFilterStore.getState().reportGames([
            makeGame('wow', 'WoW'),
            makeGame('eso', 'Elder Scrolls Online'),
        ]);

        const selected = useGameFilterStore.getState().selectedGames;
        // wow should stay deselected, eso was never seen so not auto-selected after init
        expect(selected.has('wow')).toBe(false);
        expect(useGameFilterStore.getState().allKnownGames).toHaveLength(2);
    });

    it('allKnownGames stays sorted alphabetically after multiple reports', () => {
        useGameFilterStore.getState().reportGames([
            makeGame('z', 'Zelda'),
            makeGame('a', 'Alpha'),
        ]);
        useGameFilterStore.getState().reportGames([
            makeGame('m', 'Middle Game'),
        ]);

        const names = useGameFilterStore.getState().allKnownGames.map((g) => g.name);
        expect(names).toEqual(['Alpha', 'Middle Game', 'Zelda']);
    });
});

function makeGame(slug: string, name: string): GameInfo {
    return { slug, name, coverUrl: null };
}
