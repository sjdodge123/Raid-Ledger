/** The WoW GG card (ROK-2187, metric 12, Q7): levels dinged by the player's characters. */
import type { JSX } from 'react';
import type { GgWowLevelsCard } from '@raid-ledger/contract';
import type { GgCardProps } from '../../gg-cards';
import { GgCardBody, GgKicker, GgLede, GgRankRow, GgTitle } from '../../../components/gg/gg-card-parts';

/** The card body. */
export function GgWowLevelsCardView({ payload }: GgCardProps<GgWowLevelsCard>): JSX.Element {
    const [main, ...others] = [...payload.characters].sort((a, b) => b.dings - a.dings);
    return (
        <GgCardBody>
            <GgKicker>{main ? `${main.name}${main.className ? ` · ${main.className}` : ''}` : 'Levels'}</GgKicker>
            {main && <GgTitle>{main.fromLevel != null ? `From ${main.fromLevel} to ${main.maxLevel}.` : `Level ${main.maxLevel}.`}</GgTitle>}
            <GgLede><strong>{payload.totalDings} levels dinged</strong> this year.</GgLede>
            {others.length > 0 && (
                <ol className="flex flex-col gap-1.5" aria-label="Other characters">
                    {others.slice(0, 4).map((c, i) => <GgRankRow key={c.name} rank={i + 2} name={c.name} value={`${c.dings} dings`} />)}
                </ol>
            )}
        </GgCardBody>
    );
}
