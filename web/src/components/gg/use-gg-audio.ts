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
    start: (mascot?: GgMascotSound) => void;
    /** Hold the music (a trailer is playing). */
    pauseMusic: () => void;
    /** Release `pauseMusic()`. */
    resumeMusic: () => void;
    /** Stop everything and re-arm `start()` (the Summary's Replay). */
    reset: () => void;
}

/** The mascot clip `start()` plays before the music. */
export type GgMascotSound = { soundUrl: string | null; volume: number } | null | undefined;

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

/** The persisted mute flag; `onMute` runs when it turns on (side effects outside the state updater). */
function useGgMute(onMute: () => void): [boolean, () => void] {
    const [muted, setMuted] = useState(readMuted);
    const toggle = useCallback((): void => {
        const next = !muted;
        try { window.localStorage.setItem(GG_MUTE_KEY, next ? '1' : '0'); } catch { /* private mode */ }
        if (next) onMute();
        setMuted(next);
    }, [muted, onMute]);
    return [muted, toggle];
}

interface GgMascotPlayer { play: (m: GgMascotSound) => void; stop: () => void }

/** The mascot clip, tracked so mute / replay can cut it off mid-play. */
function useMascotSound(): GgMascotPlayer {
    const ref = useRef<HTMLAudioElement | null>(null);
    const stop = useCallback((): void => { ref.current?.pause(); ref.current = null; }, []);
    const play = useCallback((m: GgMascotSound): void => {
        if (!m?.soundUrl) return;
        const s = new Audio(m.soundUrl);
        s.volume = Math.min(Math.max(m.volume, 0), 1);
        ref.current = s;
        safePlay(s);
    }, []);
    useEffect(() => stop, [stop]);
    return useMemo(() => ({ play, stop }), [play, stop]);
}

interface GgMusic {
    /** Fades the music in — unless held or not yet started. */
    play: () => void;
    pause: () => void;
    hold: (on: boolean) => void;
    /** Marks the story started; false when it already was. */
    begin: () => boolean;
    /** Stops the music, releases the hold and un-starts. */
    reset: () => void;
}

/** The GG theme's started / held state and fade. */
function useGgMusic(tracks: readonly GgTrack[]): GgMusic {
    const lazy = useLazyMusic(tracks);
    const el = useRef<HTMLAudioElement | null>(null);
    const flags = useRef({ started: false, held: false });
    const fade = useRef<ReturnType<typeof setInterval> | null>(null);
    useEffect(() => () => { if (fade.current) clearInterval(fade.current); }, []);
    return useMemo((): GgMusic => {
        const pause = (): void => { el.current?.pause(); };
        const play = (): void => {
            if (flags.current.held || !flags.current.started) return;
            const a = lazy();
            el.current = a;
            if (a === null) return;
            if (fade.current) clearInterval(fade.current);
            fade.current = fadeIn(a);
            safePlay(a);
        };
        const begin = (): boolean => {
            if (flags.current.started) return false;
            flags.current.started = true;
            return true;
        };
        const hold = (on: boolean): void => { flags.current.held = on; };
        return { play, pause, hold, begin, reset: () => { pause(); flags.current = { started: false, held: false }; } };
    }, [lazy]);
}

/** Owns the GG audio elements for one story. */
export function useGgAudio(tracks: readonly GgTrack[] = GG_MUSIC_TRACKS): GgAudio {
    const music = useGgMusic(tracks);
    const mascot = useMascotSound();
    const [muted, toggleMute] = useGgMute(useCallback(() => { music.pause(); mascot.stop(); }, [music, mascot]));
    const playMusic = useCallback((): void => { if (!muted) music.play(); }, [muted, music]);
    useEffect(() => { playMusic(); }, [playMusic]);
    const start = useCallback((m?: GgMascotSound): void => {
        if (!music.begin() || muted) return;
        mascot.play(m);
        playMusic();
    }, [music, mascot, muted, playMusic]);
    const pauseMusic = useCallback((): void => { music.hold(true); music.pause(); }, [music]);
    const resumeMusic = useCallback((): void => { music.hold(false); playMusic(); }, [music, playMusic]);
    const reset = useCallback((): void => { music.reset(); mascot.stop(); }, [music, mascot]);
    return useMemo(() => ({ muted, toggleMute, start, pauseMusic, resumeMusic, reset }),
        [muted, toggleMute, start, pauseMusic, resumeMusic, reset]);
}
