/**
 * Core GG cards 9, 11 and 12 (ROK-2187): your people (owner only — never on
 * the public page), the superlative, and the Summary with Share + music credit.
 */
import type { JSX } from 'react';
import type { GgPeopleCard, GgSummaryCard, GgSuperlativeKey } from '@raid-ledger/contract';
import type { GgCardProps } from '../../gg-cards';
import { GgCardBody, GgChip, GgKicker, GgLede, GgRankRow, GgTitle } from '../../../components/gg/gg-card-parts';
import { GG_SUPERLATIVES } from '../../../components/gg/gg-format';
import { GgSummaryFace } from '../../../components/gg/gg-summary-face';
import { GgSharePanel } from '../../../components/gg/gg-share-panel';
import { ggMusicCredits } from '../../../components/gg/gg-music';

/** Card 9 — top three people. */
export function GgPeopleCardView({ payload }: GgCardProps<GgPeopleCard>): JSX.Element {
    const [first, ...rest] = payload.people;
    return (
        <GgCardBody>
            <GgKicker>Your people</GgKicker>
            {first && <GgTitle>{first.displayName} — your raid partner of the year</GgTitle>}
            {first && <GgLede><strong>{first.sharedEvents} events</strong> side by side.</GgLede>}
            <ol className="flex flex-col gap-1.5">
                {rest.map((p, i) => <GgRankRow key={p.userId} rank={i + 2} name={p.displayName} value={`${p.sharedEvents} events`} />)}
            </ol>
            <GgLede>You played with <strong>{payload.playedWithCount} different people</strong>.</GgLede>
        </GgCardBody>
    );
}

/** Card 11 — the superlative. */
export function GgSuperlativeCardView({ payload }: GgCardProps<{ key: GgSuperlativeKey; value?: number | undefined }>): JSX.Element {
    const sup = GG_SUPERLATIVES[payload.key];
    return (
        <GgCardBody center>
            <GgKicker>Your GG persona</GgKicker>
            <p aria-hidden="true" className="text-7xl">{sup.glyph}</p>
            <GgTitle display>{sup.title}</GgTitle>
            <GgLede>{sup.line}</GgLede>
            <GgChip>GG persona</GgChip>
        </GgCardBody>
    );
}

/** Card 12 — the summary + Share toggle + the CC BY music credit. */
export function GgSummaryCardView({ payload, year }: GgCardProps<GgSummaryCard>): JSX.Element {
    return (
        <GgCardBody>
            <GgSummaryFace year={year} eventsAttended={payload.eventsAttended} hoursPlayedSeconds={payload.hoursPlayedSeconds}
                topGames={payload.topGames} playedWithCount={payload.playedWithCount} superlative={payload.superlative} />
            <div className="flex-1" />
            <GgSharePanel />
            {ggMusicCredits().map((c) => <p key={c} className="text-[11px] leading-snug text-dim" data-testid="gg-music-credit">Music: {c}</p>)}
        </GgCardBody>
    );
}
