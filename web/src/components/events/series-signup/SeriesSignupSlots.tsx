import type { JSX, ReactNode } from 'react';
import type { EventResponseDto } from '@raid-ledger/contract';
import { useSeriesSignupState } from '../../../hooks/use-series-signup';
import { JoinSeriesButton } from './JoinSeriesButton';
import { SeriesMemberActions, SeriesSkippedNight } from './SeriesMemberActions';
import { isSeriesJoinCandidate, isSeriesMember, nightFor } from './series-signup-format';

/** Beside "Sign Up" / "Join Event": Join series, or the skipped-night note for a member who declined this night. */
export function SeriesNotSignedUpSlot({ event }: { event: EventResponseDto }): JSX.Element | null {
    const candidate = isSeriesJoinCandidate(event);
    const { data: state } = useSeriesSignupState(event.id, candidate);
    if (candidate && state && isSeriesMember(state) && nightFor(state, event.id)?.state === 'stays_inactive') return <SeriesSkippedNight event={event} state={state} />;
    return <JoinSeriesButton event={event} />;
}

/**
 * The signed-up row. A member in for this night gets the series actions in
 * place of Leave; anyone else keeps Tentative + Leave, plus Join series.
 */
export function SeriesSignedUpActions({ event, statusToggle, leave, onSkip, isSkipping }: {
    event: EventResponseDto; statusToggle: ReactNode; leave: ReactNode; onSkip: () => void; isSkipping: boolean;
}): JSX.Element {
    const candidate = isSeriesJoinCandidate(event);
    const { data: state } = useSeriesSignupState(event.id, candidate);
    if (candidate && state && isSeriesMember(state) && nightFor(state, event.id)?.state === 'in_series') {
        return <SeriesMemberActions event={event} state={state} statusToggle={statusToggle} onSkip={onSkip} isSkipping={isSkipping} />;
    }
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {statusToggle}
            {leave}
            <JoinSeriesButton event={event} size="sm" />
        </div>
    );
}
