/**
 * The top game's trailer on the GG top-games card (ROK-2187 operator ruling):
 * a VISIBLE framed youtube-nocookie player, at least 200×200, nothing laid
 * over it, played only on a tap (with sound). While it plays the story stops
 * auto-advancing and the GG music pauses; both resume when it stops or the
 * card is left.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { PlayCircleIcon } from '@heroicons/react/24/solid';
import { useStoryControls } from '../ui/story-controls';
import { useGgStory } from './gg-story-context';
import { useGameDetail } from '../../hooks/use-games-discover';

/** Pause the story + music while `playing`. */
function useHoldWhilePlaying(playing: boolean): void {
    const controls = useStoryControls();
    const { audio } = useGgStory();
    const latest = useRef({ controls, audio });
    latest.current = { controls, audio };
    useEffect(() => {
        if (!playing) return undefined;
        latest.current.controls.pause();
        latest.current.audio.pauseMusic();
        return () => {
            latest.current.controls.resume();
            latest.current.audio.resumeMusic();
        };
    }, [playing]);
}

/** The framed player for one YouTube video id. */
export function GgTrailerPlayer({ videoId, title }: { videoId: string; title: string }): JSX.Element {
    const [playing, setPlaying] = useState(false);
    useHoldWhilePlaying(playing);
    const frame = 'aspect-video min-h-[200px] w-full min-w-[200px] overflow-hidden rounded-xl border border-edge bg-backdrop';
    return (
        <div className="flex w-full flex-col items-center gap-2">
            <div className={frame} data-testid="gg-trailer-frame">
                {playing ? (
                    <iframe src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&playsinline=1&rel=0`}
                        title={title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen className="h-full w-full" />
                ) : (
                    <button type="button" onClick={() => setPlaying(true)}
                        className="flex h-full w-full flex-col items-center justify-center gap-1 text-foreground">
                        <PlayCircleIcon aria-hidden="true" className="h-14 w-14" />
                        <span className="font-semibold">Play trailer</span>
                        <span className="text-xs text-muted">{title} · plays with sound</span>
                    </button>
                )}
            </div>
            {playing && (
                <button type="button" onClick={() => setPlaying(false)} className="text-sm text-secondary underline">Stop trailer</button>
            )}
        </div>
    );
}

/** The first IGDB-listed trailer of `gameId`, or nothing. */
export function GgTrailer({ gameId, gameName }: { gameId: number; gameName: string }): JSX.Element | null {
    const { data } = useGameDetail(gameId);
    const videoId = data?.videos?.[0]?.videoId;
    if (!videoId) return null;
    return <GgTrailerPlayer videoId={videoId} title={`${gameName} trailer`} />;
}
