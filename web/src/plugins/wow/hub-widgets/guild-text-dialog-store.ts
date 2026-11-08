/**
 * ROK-2136 — which hub's guild-text editor is open. The header "Edit" and the
 * card's "Add guild text" open it; the card body mounts the lazy dialog from
 * it. A tiny store so the eager header action never imports the dialog chunk.
 */
import { create } from 'zustand';

interface GuildTextDialogState {
    /** The hub whose editor is open, or null. */
    guildId: number | null;
    open: (guildId: number) => void;
    close: () => void;
}

export const useGuildTextDialog = create<GuildTextDialogState>((set) => ({
    guildId: null,
    open: (guildId) => set({ guildId }),
    close: () => set({ guildId: null }),
}));
