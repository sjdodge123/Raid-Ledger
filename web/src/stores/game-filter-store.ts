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

function mergeKnownGames(existing: GameInfo[], incoming: GameInfo[]): GameInfo[] {
    const map = new Map(existing.map((g) => [g.slug, g]));
    for (const g of incoming) map.set(g.slug, g);
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function discoverNewSlugs(
    seenSlugs: Set<string>,
    games: GameInfo[],
): { nextSeen: Set<string>; newSlugs: string[] } {
    const nextSeen = new Set(seenSlugs);
    const newSlugs: string[] = [];
    for (const g of games) {
        if (!nextSeen.has(g.slug)) {
            newSlugs.push(g.slug);
            nextSeen.add(g.slug);
        }
    }
    return { nextSeen, newSlugs };
}

function applyGameSelection(
    set: (partial: Partial<GameFilterState>) => void,
    state: GameFilterState,
    games: GameInfo[],
    nextAllKnown: GameInfo[],
    nextSeen: Set<string>,
    newSlugs: string[],
): void {
    if (!state.hasInitialized && games.length > 0) {
        set({
            allKnownGames: nextAllKnown,
            selectedGames: new Set(games.map((g) => g.slug)),
            seenSlugs: nextSeen,
            hasInitialized: true,
        });
    } else if (newSlugs.length > 0) {
        set({ allKnownGames: nextAllKnown, seenSlugs: nextSeen });
    } else if (nextAllKnown.length !== state.allKnownGames.length) {
        set({ allKnownGames: nextAllKnown });
    }
}

function toggleSlug(selectedGames: Set<string>, slug: string): Set<string> {
    const next = new Set(selectedGames);
    if (next.has(slug)) next.delete(slug); else next.add(slug);
    return next;
}

const INITIAL_FILTER_STATE = { allKnownGames: [] as GameInfo[], selectedGames: new Set<string>(), hasInitialized: false, seenSlugs: new Set<string>() };

export const useGameFilterStore = create<GameFilterState>((set, get) => ({
    ...INITIAL_FILTER_STATE,

    reportGames(games: GameInfo[]) {
        const state = get();
        const nextAllKnown = mergeKnownGames(state.allKnownGames, games);
        const { nextSeen, newSlugs } = discoverNewSlugs(state.seenSlugs, games);
        applyGameSelection(set, state, games, nextAllKnown, nextSeen, newSlugs);
    },

    toggleGame(slug: string) { set({ selectedGames: toggleSlug(get().selectedGames, slug) }); },
    selectAll() { set({ selectedGames: new Set(get().allKnownGames.map((g) => g.slug)) }); },
    deselectAll() { set({ selectedGames: new Set<string>() }); },
    _reset() { set({ ...INITIAL_FILTER_STATE }); },
}));
