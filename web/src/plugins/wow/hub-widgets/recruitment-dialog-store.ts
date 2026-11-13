/**
 * ROK-1789 — which hub's recruitment editor is open. The header "Edit" and the
 * card's "Set recruitment" open it; the card body mounts the lazy dialog from
 * it. A tiny store so the eager header action never imports the dialog chunk.
 */
import { create } from 'zustand';

interface RecruitmentDialogState {
    /** The hub whose editor is open, or null. */
    guildId: number | null;
    open: (guildId: number) => void;
    close: () => void;
}

export const useRecruitmentDialog = create<RecruitmentDialogState>((set) => ({
    guildId: null,
    open: (guildId) => set({ guildId }),
    close: () => set({ guildId: null }),
}));
