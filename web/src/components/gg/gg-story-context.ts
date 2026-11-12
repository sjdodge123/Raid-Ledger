/**
 * What every "GG <year>" card can read besides its own payload (ROK-2187):
 * the year, tier, share state, mascot, the intro gate and the audio controls.
 */
import { createContext, useContext } from 'react';
import type { GgActivityTier, GgShareStateDto } from '@raid-ledger/contract';
import type { GgMascotView } from '../../lib/api/gg-api';
import type { GgAudio } from './use-gg-audio';

export interface GgStoryContextValue {
    year: number;
    tier: GgActivityTier;
    share: GgShareStateDto;
    mascot: GgMascotView | null;
    /** True once "Tap to start" was pressed. */
    started: boolean;
    /** Leave the intro gate (plays sound unless muted). */
    start: () => void;
    audio: GgAudio;
}

const NOOP_AUDIO: GgAudio = { muted: true, toggleMute: () => {}, start: () => {}, pauseMusic: () => {}, resumeMusic: () => {} };

export const GgStoryContext = createContext<GgStoryContextValue>({
    year: new Date().getFullYear(), tier: 'full', share: { shared: false, slug: null, sharedAt: null },
    mascot: null, started: true, start: () => {}, audio: NOOP_AUDIO,
});

/** The enclosing GG story. */
export function useGgStory(): GgStoryContextValue {
    return useContext(GgStoryContext);
}
