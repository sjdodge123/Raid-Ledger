/** Valheim's GG card (ROK-2187, metric 11): deaths + skills gained on claimed characters. */
import type { JSX } from 'react';
import type { GgValheimCard } from '@raid-ledger/contract';
import type { GgCardProps } from '../../gg-cards';
import { GgCardBody, GgKicker, GgRankRow, GgStat, GgStats, GgTitle } from '../../../components/gg/gg-card-parts';

/** The card body. */
export function GgValheimCardView({ payload }: GgCardProps<GgValheimCard>): JSX.Element {
    const top = [...payload.skillGains].sort((a, b) => b.gained - a.gained).slice(0, 4);
    return (
        <GgCardBody>
            <GgKicker>Valheim</GgKicker>
            <GgTitle>{payload.deaths === 0 ? 'Not a single death.' : `${payload.deaths} trips to Valhalla.`}</GgTitle>
            <GgStats>
                <GgStat value={payload.characters} label={payload.characters === 1 ? 'character' : 'characters'} />
                <GgStat value={payload.deaths} label="deaths" />
            </GgStats>
            {top.length > 0 && (
                <ol className="flex flex-col gap-1.5" aria-label="Skills gained">
                    {top.map((s, i) => <GgRankRow key={s.skill} rank={i + 1} name={s.skill} value={`+${Math.round(s.gained)}`} />)}
                </ol>
            )}
        </GgCardBody>
    );
}
