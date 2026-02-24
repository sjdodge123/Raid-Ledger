import { create } from 'zustand';

export interface GameInfo {
    slug: string;
    name: string;
    coverUrl: string | null;
}

interface GameFilterState {
    /** Accumulator of all games ever seen (only grows). */
    allKnownGames: GameInfo[];
    /** Slugs the user currently has selected for filtering. */
    selectedGames: Set<string>;
    /** Whether the initial auto-select-all has fired. */
    hasInitialized: boolean;
    /** All slugs we've ever encountered (prevents re-auto-selecting deselected games). */
    seenSlugs: Set<string>;

    /**
     * Called by CalendarView whenever the visible games list changes.
     * Merges into allKnownGames and auto-selects only truly new games.
     */
    reportGames: (games: GameInfo[]) => void;
    toggleGame: (slug: string) => void;
    selectAll: () => void;
    deselectAll: () => void;
    /** Reset to initial state (for tests). */
    _reset: () => void;
}

export const useGameFilterStore = create<GameFilterState>((set, get) => ({
    allKnownGames: [],
    selectedGames: new Set<string>(),
    hasInitialized: false,
    seenSlugs: new Set<string>(),

    reportGames(games: GameInfo[]) {
        const state = get();

        // 1. Merge into allKnownGames (accumulator that only grows)
        const map = new Map(state.allKnownGames.map((g) => [g.slug, g]));
        for (const g of games) map.set(g.slug, g);
        const nextAllKnown = Array.from(map.values()).sort((a, b) =>
            a.name.localeCompare(b.name),
        );

        // 2. Determine truly new slugs (never seen before)
        const nextSeen = new Set(state.seenSlugs);
        const newSlugs: string[] = [];
        for (const g of games) {
            if (!nextSeen.has(g.slug)) {
                newSlugs.push(g.slug);
                nextSeen.add(g.slug);
            }
        }

        // 3. Update selection
        let nextSelected: Set<string>;
        if (!state.hasInitialized && games.length > 0) {
            // First time we see any games — select all of them
            nextSelected = new Set(games.map((g) => g.slug));
            set({
                allKnownGames: nextAllKnown,
                selectedGames: nextSelected,
                seenSlugs: nextSeen,
                hasInitialized: true,
            });
        } else if (newSlugs.length > 0) {
            // Auto-select only games we've never seen before
            nextSelected = new Set(state.selectedGames);
            for (const slug of newSlugs) nextSelected.add(slug);
            set({
                allKnownGames: nextAllKnown,
                selectedGames: nextSelected,
                seenSlugs: nextSeen,
            });
        } else {
            // No new games — just update allKnownGames if it changed
            if (nextAllKnown.length !== state.allKnownGames.length) {
                set({ allKnownGames: nextAllKnown });
            }
        }
    },

    toggleGame(slug: string) {
        const next = new Set(get().selectedGames);
        if (next.has(slug)) {
            next.delete(slug);
        } else {
            next.add(slug);
        }
        set({ selectedGames: next });
    },

    selectAll() {
        set({ selectedGames: new Set(get().allKnownGames.map((g) => g.slug)) });
    },

    deselectAll() {
        set({ selectedGames: new Set<string>() });
    },

    _reset() {
        set({
            allKnownGames: [],
            selectedGames: new Set<string>(),
            hasInitialized: false,
            seenSlugs: new Set<string>(),
        });
    },
}));
