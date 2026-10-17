import { create } from 'zustand';
import { updatePreference } from '../lib/api-client';
import { getAuthToken } from '../hooks/use-auth';

export interface GameInfo {
    slug: string;
    name: string;
    coverUrl: string | null;
}

/** Tracks whether the last selection change was user-initiated or loaded from preferences. */
export type ChangeSource = 'user' | 'loaded';

interface GameFilterState {
    /** Accumulator of all games ever seen (only grows). */
    allKnownGames: GameInfo[];
    /** Slugs the user currently has selected for filtering. */
    selectedGames: Set<string>;
    /** Whether the initial auto-select-all has fired. */
    hasInitialized: boolean;
    /** All slugs we've ever encountered (prevents re-auto-selecting deselected games). */
    seenSlugs: Set<string>;
    /** Whether a saved filter has been loaded from preferences. */
    hasSavedFilter: boolean;
    /** Saved filter slugs (loaded before games may be known). */
    savedFilterSlugs: string[] | null;
    /** Whether the last selection change was user-initiated or loaded from prefs. */
    lastChangeSource: ChangeSource;

    /** Merge incoming games and auto-select truly new ones. */
    reportGames: (games: GameInfo[]) => void;
    toggleGame: (slug: string) => void;
    selectAll: () => void;
    deselectAll: () => void;
    /** Load a saved filter from user preferences. */
    loadSavedFilter: (slugs: string[]) => void;
    /** Persist the current filter selection to user preferences. */
    saveFilter: () => void;
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

/** Apply game selection on first report, respecting saved filter if present. */
function applyGameSelection(
    set: (partial: Partial<GameFilterState>) => void,
    state: GameFilterState,
    games: GameInfo[],
    nextAllKnown: GameInfo[],
    nextSeen: Set<string>,
    newSlugs: string[],
): void {
    if (!state.hasInitialized && games.length > 0) {
        const selected = resolveInitialSelection(state.savedFilterSlugs, games);
        set({
            allKnownGames: nextAllKnown,
            selectedGames: selected,
            seenSlugs: nextSeen,
            hasInitialized: true,
            lastChangeSource: 'loaded',
        });
    } else if (newSlugs.length > 0) {
        set({ allKnownGames: nextAllKnown, seenSlugs: nextSeen });
    } else if (nextAllKnown.length !== state.allKnownGames.length) {
        set({ allKnownGames: nextAllKnown });
    }
}

/** Resolve initial selection, falling back to all games when saved filter is empty or fully stale. */
function resolveInitialSelection(savedSlugs: string[] | null, games: GameInfo[]): Set<string> {
    if (!savedSlugs) return new Set(games.map((g) => g.slug));
    const knownSlugs = new Set(games.map((g) => g.slug));
    const hasAnyValid = savedSlugs.some((s) => knownSlugs.has(s));
    if (savedSlugs.length === 0 || !hasAnyValid) return new Set(games.map((g) => g.slug));
    return new Set(savedSlugs);
}

function toggleSlug(selectedGames: Set<string>, slug: string): Set<string> {
    const next = new Set(selectedGames);
    if (next.has(slug)) next.delete(slug); else next.add(slug);
    return next;
}

/** Persist filter to server (fire-and-forget). */
function syncFilterToServer(slugs: string[]): void {
    if (getAuthToken()) {
        updatePreference('calendarGameFilter', slugs).catch(() => {
            // Fire-and-forget — silent failure for offline/unauth
        });
    }
}

/** Apply a saved filter from preferences, falling back to all if intersection is empty. */
function applyLoadedFilter(
    set: (partial: Partial<GameFilterState>) => void,
    state: GameFilterState,
    slugs: string[],
): void {
    if (state.hasInitialized) {
        const selected = resolveLoadedSelection(slugs, state.allKnownGames);
        set({ selectedGames: selected, hasSavedFilter: true, savedFilterSlugs: slugs, lastChangeSource: 'loaded' });
    } else {
        set({ hasSavedFilter: true, savedFilterSlugs: slugs, lastChangeSource: 'loaded' });
    }
}

/** Resolve loaded selection, falling back to all games when slugs are empty or fully stale. */
function resolveLoadedSelection(slugs: string[], allKnownGames: GameInfo[]): Set<string> {
    const knownSlugs = new Set(allKnownGames.map((g) => g.slug));
    const hasAnyValid = slugs.some((s) => knownSlugs.has(s));
    if (slugs.length === 0 || !hasAnyValid) return new Set(allKnownGames.map((g) => g.slug));
    return new Set(slugs);
}

const INITIAL_STATE = {
    allKnownGames: [] as GameInfo[],
    selectedGames: new Set<string>(),
    hasInitialized: false,
    seenSlugs: new Set<string>(),
    hasSavedFilter: false,
    savedFilterSlugs: null as string[] | null,
    lastChangeSource: 'loaded' as ChangeSource,
};

export const useGameFilterStore = create<GameFilterState>((set, get) => ({
    ...INITIAL_STATE,
    reportGames(games: GameInfo[]) {
        const state = get();
        const nextAllKnown = mergeKnownGames(state.allKnownGames, games);
        const { nextSeen, newSlugs } = discoverNewSlugs(state.seenSlugs, games);
        applyGameSelection(set, state, games, nextAllKnown, nextSeen, newSlugs);
    },
    toggleGame(slug: string) { set({ selectedGames: toggleSlug(get().selectedGames, slug), lastChangeSource: 'user' }); },
    selectAll() { set({ selectedGames: new Set(get().allKnownGames.map((g) => g.slug)), lastChangeSource: 'user' }); },
    deselectAll() { set({ selectedGames: new Set<string>(), lastChangeSource: 'user' }); },
    loadSavedFilter(slugs: string[]) { applyLoadedFilter(set, get(), slugs); },
    saveFilter() { syncFilterToServer([...get().selectedGames]); },
    _reset() { set({ ...INITIAL_STATE }); },
}));
