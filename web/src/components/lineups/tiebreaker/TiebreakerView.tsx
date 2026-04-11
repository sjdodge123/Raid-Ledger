/**
 * TiebreakerView (ROK-938).
 * Mode router: renders BracketView or VetoView based on tiebreaker mode.
 */
import type { JSX } from 'react';
import type { TiebreakerDetailDto } from '@raid-ledger/contract';
import { BracketView } from './BracketView';
import { VetoView } from './VetoView';
import { TiebreakerCountdown } from './TiebreakerCountdown';

interface Props {
    tiebreaker: TiebreakerDetailDto;
    lineupId: number;
}

export function TiebreakerView({ tiebreaker, lineupId }: Props): JSX.Element {
    return (
        <div>
            <div className="flex items-center gap-2 mb-2">
                <TiebreakerCountdown deadline={tiebreaker.roundDeadline} />
            </div>
            {tiebreaker.mode === 'bracket' ? (
                <BracketView tiebreaker={tiebreaker} lineupId={lineupId} />
            ) : (
                <VetoView tiebreaker={tiebreaker} lineupId={lineupId} />
            )}
        </div>
    );
}
