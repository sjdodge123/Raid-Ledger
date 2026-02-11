import { create } from 'zustand';

interface PluginState {
    activeSlugs: Set<string>;
    initialized: boolean;
    setActiveSlugs: (slugs: string[]) => void;
    isPluginActive: (slug: string) => boolean;
}

export const usePluginStore = create<PluginState>((set, get) => ({
    activeSlugs: new Set<string>(),
    initialized: false,

    setActiveSlugs(slugs: string[]) {
        set({ activeSlugs: new Set(slugs), initialized: true });
    },

    isPluginActive(slug: string) {
        return get().activeSlugs.has(slug);
    },
}));
