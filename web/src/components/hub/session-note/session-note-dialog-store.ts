/**
 * ROK-1968 — which hub's note editor is open. The card's "Add note" hint and
 * the header "Edit" action open it; the editor dialog (W2) reads it. Kept as a
 * tiny store so the eager header action never imports the dialog chunk.
 */
import { create } from 'zustand';

interface SessionNoteDialogState {
    /** The hub whose editor is open, or null. */
    guildId: number | null;
    open: (guildId: number) => void;
    close: () => void;
}

export const useSessionNoteDialog = create<SessionNoteDialogState>((set) => ({
    guildId: null,
    open: (guildId) => set({ guildId }),
    close: () => set({ guildId: null }),
}));
