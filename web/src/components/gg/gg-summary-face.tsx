/**
 * The GG summary numbers (ROK-2187) — shared by the owner's Summary card and
 * the public `/w/:slug` page. Other players appear only as a COUNT (Q4).
 */
import type { JSX } from 'react';
import type { GgSuperlativeKey } from '@raid-ledger/contract';
import { GgKicker, GgStat, GgStats, GgTitle } from './gg-card-parts';
import { GG_SUPERLATIVES, ggHours } from './gg-format';

export interface GgSummaryFaceProps {
    year: number;
    displayName?: string | null;
    eventsAttended: number;
    hoursPlayedSeconds: number;
    topGames: readonly { name: string }[];
    playedWithCount: number;
    superlative: GgSuperlativeKey | null;
}

/** Headline + stat grid + top games. */
export function GgSummaryFace(p: GgSummaryFaceProps): JSX.Element {
    const sup = p.superlative === null ? null : GG_SUPERLATIVES[p.superlative];
    return (
        <>
            <GgKicker>{p.displayName ? `${p.displayName} · ` : ''}GG {p.year}</GgKicker>
            <GgTitle display>{sup ? `${sup.glyph} ${sup.title}` : `GG ${p.year}`}</GgTitle>
            <GgStats>
                <GgStat value={p.eventsAttended} label="events" />
                <GgStat value={ggHours(p.hoursPlayedSeconds)} label="played" />
                <GgStat value={p.playedWithCount} label="people played with" />
            </GgStats>
            {p.topGames.length > 0 && (
                <p className="text-sm text-secondary">Top games: <span className="font-semibold text-foreground">{p.topGames.map((g) => g.name).join(' · ')}</span></p>
            )}
        </>
    );
}
