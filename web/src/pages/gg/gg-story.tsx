/**
 * One year's GG story (ROK-2187): resolves the snapshot's cards against the
 * registered renderers and active plugins (cards with no data or an inactive
 * plugin are simply absent — the short GG), gates the intro behind "Tap to
 * start" and owns the sound.
 */
import { useCallback, useMemo, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { StoryViewer } from '../../components/ui/story-viewer';
import { GgStoryContext, type GgStoryContextValue } from '../../components/gg/gg-story-context';
import { GgMuteToggle } from '../../components/gg/gg-mute-toggle';
import { useGgAudio } from '../../components/gg/use-gg-audio';
import { resolveGgCards } from '../../plugins/gg-cards';
import { usePluginStore } from '../../stores/plugin-store';
import type { GgOwnerSnapshot } from '../../lib/api/gg-api';
import { buildGgSlides, topGameMedia, useGgBackdrops } from './gg-slides';
import { ggPrefersLowData } from '../../components/gg/gg-low-data';

function HeaderExtra({ snapshot, audio }: { snapshot: GgOwnerSnapshot; audio: GgStoryContextValue['audio'] }): JSX.Element {
    return (
        <div className="flex items-center gap-1">
            {snapshot.archiveYears.length > 1 && (
                <Link to="/gg/archive" className="rounded-md px-2 py-1 text-xs font-medium text-secondary hover:text-foreground">Past years</Link>
            )}
            <GgMuteToggle audio={audio} />
        </div>
    );
}

/**
 * The intro gate + replay: `started` flips on "Tap to start"; `replay` stops the
 * music, re-arms the gate and bumps `run` (the StoryViewer key → slide 1).
 */
interface GgRun { started: boolean; start: () => void; replay: () => void; run: number }

function useGgRun(gated: boolean, audio: GgStoryContextValue['audio'], mascot: GgStoryContextValue['mascot']): GgRun {
    const [started, setStarted] = useState(!gated);
    const [run, setRun] = useState(0);
    const start = useCallback((): void => {
        if (started) return;
        setStarted(true);
        audio.start(mascot);
    }, [started, audio, mascot]);
    const replay = useCallback((): void => {
        audio.pauseMusic();
        setStarted(!gated);
        setRun((r) => r + 1);
    }, [audio, gated]);
    return { started, start, replay, run };
}

/** The full-screen story for `snapshot`. */
export function GgStory({ snapshot, onClose }: { snapshot: GgOwnerSnapshot; onClose: () => void }): JSX.Element {
    const active = usePluginStore((s) => s.activeSlugs);
    const cards = useMemo(() => resolveGgCards(snapshot.cards, active), [snapshot.cards, active]);
    const audio = useGgAudio();
    const mascot = snapshot.mascot ?? null;
    const { started, start, replay, run } = useGgRun(cards[0]?.key === 'core:intro', audio, mascot);
    const still = useMemo(() => ggPrefersLowData(), []);
    const media = useMemo(() => topGameMedia(snapshot.cards), [snapshot.cards]);
    const backdrops = useGgBackdrops(media);
    const slides = useMemo(() => buildGgSlides(cards, snapshot.year, backdrops, started, still), [cards, snapshot.year, backdrops, started, still]);
    const ctx = useMemo<GgStoryContextValue>(() => ({
        year: snapshot.year, tier: snapshot.tier, share: snapshot.share, mascot, started, start, replay, audio,
    }), [snapshot.year, snapshot.tier, snapshot.share, mascot, started, start, replay, audio]);
    return (
        <GgStoryContext.Provider value={ctx}>
            <StoryViewer key={run} title={`GG ${snapshot.year}`} slides={slides} onClose={onClose} paused={!started}
                onIndexChange={(i) => { if (i > 0) start(); }}
                headerExtra={<HeaderExtra snapshot={snapshot} audio={audio} />} />
        </GgStoryContext.Provider>
    );
}
