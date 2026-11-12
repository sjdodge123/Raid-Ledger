/**
 * Sound for "GG <year>" (ROK-2187): the mascot sound and the GG theme. Nothing
 * plays until `start()` — called from the "Tap to start" gesture (AC9, iOS
 * needs a user gesture). Mute is persisted per browser. A missing or blocked
 * track is ignored: the story simply has no music.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GG_MUSIC_TRACKS, GG_MUSIC_VOLUME, type GgTrack } from './gg-music';

export const GG_MUTE_KEY = 'gg:muted';
const FADE_STEPS = 20;
const FADE_MS = 2000;

/** The audio controls every GG card can reach. */
export interface GgAudio {
    muted: boolean;
    toggleMute: () => void;
    /** Plays the mascot sound (if any), then fades the music in. Only call from a user gesture. */
    start: (mascot?: { soundUrl: string | null; volume: number } | null) => void;
    /** Hold the music (a trailer is playing). */
    pauseMusic: () => void;
    /** Release `pauseMusic()`. */
    resumeMusic: () => void;
}

function readMuted(): boolean {
    try { return window.localStorage.getItem(GG_MUTE_KEY) === '1'; } catch { return false; }
}

function safePlay(el: HTMLAudioElement): void {
    try { void Promise.resolve(el.play()).catch(() => undefined); } catch { /* no music */ }
}

function fadeIn(el: HTMLAudioElement): ReturnType<typeof setInterval> {
    let step = 0;
    el.volume = 0;
    return setInterval(() => {
        step = Math.min(step + 1, FADE_STEPS);
        el.volume = (GG_MUSIC_VOLUME * step) / FADE_STEPS;
    }, FADE_MS / FADE_STEPS);
}

/** The music element, created on first use — never before the start tap (no preload). */
function useLazyMusic(tracks: readonly GgTrack[]): () => HTMLAudioElement | null {
    const ref = useRef<HTMLAudioElement | null>(null);
    useEffect(() => () => { if (ref.current) { ref.current.pause(); ref.current.onended = null; } }, []);
    return useCallback((): HTMLAudioElement | null => {
        const first = tracks[0];
        if (ref.current !== null || first === undefined) return ref.current;
        const el = new Audio(first.url);
        let i = 0;
        el.onended = () => { i = (i + 1) % tracks.length; el.src = tracks[i]?.url ?? first.url; safePlay(el); };
        ref.current = el;
        return el;
    }, [tracks]);
}

/** Owns the GG audio elements for one story. */
export function useGgAudio(tracks: readonly GgTrack[] = GG_MUSIC_TRACKS): GgAudio {
    const [muted, setMuted] = useState(readMuted);
    const started = useRef(false);
    const held = useRef(false);
    const music = useLazyMusic(tracks);
    const existing = useRef<HTMLAudioElement | null>(null);
    const fade = useRef<ReturnType<typeof setInterval> | null>(null);
    useEffect(() => () => { if (fade.current) clearInterval(fade.current); }, []);

    const playMusic = useCallback((): void => {
        if (muted || held.current || !started.current) return;
        const el = music();
        existing.current = el;
        if (el === null) return;
        if (fade.current) clearInterval(fade.current);
        fade.current = fadeIn(el);
        safePlay(el);
    }, [music, muted]);

    const toggleMute = useCallback((): void => {
        setMuted((m) => {
            const next = !m;
            try { window.localStorage.setItem(GG_MUTE_KEY, next ? '1' : '0'); } catch { /* private mode */ }
            if (next) existing.current?.pause();
            return next;
        });
    }, []);

    useEffect(() => { if (!muted) playMusic(); }, [muted, playMusic]);

    const start = useCallback((mascot?: { soundUrl: string | null; volume: number } | null): void => {
        if (started.current) return;
        started.current = true;
        if (muted) return;
        if (mascot?.soundUrl) {
            const s = new Audio(mascot.soundUrl);
            s.volume = Math.min(Math.max(mascot.volume, 0), 1);
            safePlay(s);
        }
        playMusic();
    }, [muted, playMusic]);

    const pauseMusic = useCallback((): void => { held.current = true; existing.current?.pause(); }, []);
    const resumeMusic = useCallback((): void => { held.current = false; playMusic(); }, [playMusic]);

    return useMemo(() => ({ muted, toggleMute, start, pauseMusic, resumeMusic }), [muted, toggleMute, start, pauseMusic, resumeMusic]);
}
