/**
 * ROK-1927 — the seam between the "Attunements" card's header action ("See
 * who") and the per-member detail (Modal / BottomSheet, phase P5). The eager
 * header action only calls `open(guildId)`; the detail mounts lazily from the
 * card body when `guildId` matches the hub and calls `close()` on dismiss. A
 * tiny store so the header never imports the detail chunk (the
 * `guild-text-dialog-store.ts` pattern).
 */
import { create } from 'zustand';

interface AttunementsDetailState {
    /** The hub whose attunement detail is open, or null. */
    guildId: number | null;
    open: (guildId: number) => void;
    close: () => void;
}

export const useAttunementsDetail = create<AttunementsDetailState>((set) => ({
    guildId: null,
    open: (guildId) => set({ guildId }),
    close: () => set({ guildId: null }),
}));
