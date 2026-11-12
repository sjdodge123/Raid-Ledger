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
import { buildGgSlides, topGameId, useGgBackdrops } from './gg-slides';

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

/** The full-screen story for `snapshot`. */
export function GgStory({ snapshot, onClose }: { snapshot: GgOwnerSnapshot; onClose: () => void }): JSX.Element {
    const active = usePluginStore((s) => s.activeSlugs);
    const cards = useMemo(() => resolveGgCards(snapshot.cards, active), [snapshot.cards, active]);
    const audio = useGgAudio();
    const gated = cards[0]?.key === 'core:intro';
    const [started, setStarted] = useState(!gated);
    const mascot = snapshot.mascot ?? null;
    const start = useCallback((): void => {
        if (started) return;
        setStarted(true);
        audio.start(mascot);
    }, [started, audio, mascot]);
    const backdrops = useGgBackdrops(topGameId(snapshot.cards));
    const slides = useMemo(() => buildGgSlides(cards, snapshot.year, backdrops, started), [cards, snapshot.year, backdrops, started]);
    const ctx = useMemo<GgStoryContextValue>(() => ({
        year: snapshot.year, tier: snapshot.tier, share: snapshot.share, mascot, started, start, audio,
    }), [snapshot.year, snapshot.tier, snapshot.share, mascot, started, start, audio]);
    return (
        <GgStoryContext.Provider value={ctx}>
            <StoryViewer title={`GG ${snapshot.year}`} slides={slides} onClose={onClose} paused={!started}
                onIndexChange={(i) => { if (i > 0) start(); }}
                headerExtra={<HeaderExtra snapshot={snapshot} audio={audio} />} />
        </GgStoryContext.Provider>
    );
}
