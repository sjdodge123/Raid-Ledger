/**
 * ROK-1814 — the picker's unsaved choice and how Save turns it into a write.
 * The preset draft may hold fg = bg; `canSaveCrest` refuses it (Q10).
 */
import { useState } from 'react';
import {
    GUILD_CREST_EMBLEM_IDS, type GuildCrestEditorState, type GuildCrestEmblemId, type GuildCrestPaletteId, type SetGuildCrest,
} from '@raid-ledger/contract';

export type CrestMode = 'upload' | 'preset' | 'gallery' | 'none';

export interface PresetDraft { emblemId: GuildCrestEmblemId; fg: GuildCrestPaletteId; bg: GuildCrestPaletteId }

export interface CrestDraft {
    mode: CrestMode;
    preset: PresetDraft;
    mediaId: number | null;
}

const DEFAULT_PRESET: PresetDraft = { emblemId: GUILD_CREST_EMBLEM_IDS[0], fg: 'or', bg: 'azure' };

/** Opens on what the hub shows now; a hub without a crest opens on the emblem grid. */
export function initialDraft(state: GuildCrestEditorState): CrestDraft {
    return { mode: state.active ?? 'preset', preset: state.preset ?? DEFAULT_PRESET, mediaId: null };
}

export function presetColoursClash(preset: PresetDraft): boolean {
    return preset.fg === preset.bg;
}

export function canSaveCrest(draft: CrestDraft, state: GuildCrestEditorState): boolean {
    if (draft.mode === 'preset') return !presetColoursClash(draft.preset);
    if (draft.mode === 'gallery') return draft.mediaId !== null;
    if (draft.mode === 'upload') return state.upload !== null;
    return true;
}

/** The `PUT` body for every mode but `gallery` (which posts its `mediaId`). */
export function setBodyFor(draft: CrestDraft): SetGuildCrest | null {
    if (draft.mode === 'preset') return { active: 'preset', preset: draft.preset };
    if (draft.mode === 'upload') return { active: 'upload' };
    if (draft.mode === 'none') return { active: null };
    return null;
}

export interface CrestDraftApi {
    draft: CrestDraft;
    setMode: (mode: CrestMode) => void;
    setPreset: (patch: Partial<PresetDraft>) => void;
    setMediaId: (id: number) => void;
}

export function useCrestDraft(state: GuildCrestEditorState): CrestDraftApi {
    const [draft, setDraft] = useState<CrestDraft>(() => initialDraft(state));
    return {
        draft,
        setMode: (mode) => setDraft((d) => ({ ...d, mode })),
        setPreset: (patch) => setDraft((d) => ({ ...d, preset: { ...d.preset, ...patch } })),
        setMediaId: (mediaId) => setDraft((d) => ({ ...d, mediaId })),
    };
}
