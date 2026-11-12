/**
 * The bundled "GG theme" soundtrack (ROK-2187 operator rulings 2026-11-12):
 * royalty-free tracks Raid Ledger hosts itself under `/gg/music/` (ad-free for
 * every viewer), files + licences in `web/public/gg/music/CREDITS.md`. CC BY
 * tracks carry a credit shown on the Summary card. A track that fails to load
 * is skipped quietly — the story then runs without music.
 */

/** One bundled track. */
export interface GgTrack {
    id: string;
    title: string;
    /** Same-origin URL (CSP has no media-src, so audio must be self-hosted). */
    url: string;
    licence: 'CC0' | 'CC BY 4.0';
    /** Attribution line required by the licence, or null (CC0). */
    credit: string | null;
}

/** The GG playlist, played in order and looped. */
export const GG_MUSIC_TRACKS: readonly GgTrack[] = [
    { id: 'last-journey', title: 'Last Journey', url: '/gg/music/last-journey.mp3', licence: 'CC0', credit: null },
    { id: 'town-theme-rpg', title: 'Town Theme RPG', url: '/gg/music/town-theme-rpg.mp3', licence: 'CC0', credit: null },
    {
        id: 'heroic-age', title: 'Heroic Age', url: '/gg/music/heroic-age.mp3', licence: 'CC BY 4.0',
        credit: '"Heroic Age" Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0 License, http://creativecommons.org/licenses/by/4.0/',
    },
];

/** Credit lines the Summary card must show for the playlist. */
export function ggMusicCredits(tracks: readonly GgTrack[] = GG_MUSIC_TRACKS): string[] {
    return tracks.flatMap((t) => (t.credit === null ? [] : [t.credit]));
}

/** Music volume once faded in (0–1). */
export const GG_MUSIC_VOLUME = 0.5;
