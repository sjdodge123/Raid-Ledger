import { useState, type JSX, type ReactNode } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import type { EventResponseDto, SeriesSignupStateDto } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { useLeaveSeries } from '../../../hooks/use-series-signup';
import { LeaveSeriesConfirm } from './LeaveSeriesConfirm';
import { formatNightDate, leaveNights, memberNights, nightsLabel } from './series-signup-format';

/** "In for the series" plus a muted note. */
function InForSeries({ note }: { note: string }): JSX.Element {
    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
                <ArrowPathIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
                In for the series
            </span>
            <span className="text-xs text-muted">{note}</span>
        </div>
    );
}

/** "Leave series" and its confirm; the confirm is mounted only while open. */
function LeaveSeriesButton({ event, state }: { event: EventResponseDto; state: SeriesSignupStateDto }): JSX.Element {
    const [open, setOpen] = useState(false);
    const leave = useLeaveSeries(event.id);
    return (
        <>
            <Button variant="destructive-soft" size="sm" onClick={() => setOpen(true)} data-testid="leave-series">Leave series</Button>
            {open && (
                <LeaveSeriesConfirm seriesTitle={event.title} nights={leaveNights(state)} isPending={leave.isPending}
                    onClose={() => setOpen(false)} onConfirm={() => leave.mutate(undefined, { onSuccess: () => setOpen(false) })} />
            )}
        </>
    );
}

/** A member who is in for this night: Tentative/Confirm, Skip this night, Leave series. */
export function SeriesMemberActions({ event, state, statusToggle, onSkip, isSkipping }: {
    event: EventResponseDto; state: SeriesSignupStateDto; statusToggle: ReactNode; onSkip: () => void; isSkipping: boolean;
}): JSX.Element {
    const nights = memberNights(state);
    const last = nights[nights.length - 1];
    return (
        <div className="flex flex-col gap-1.5" data-testid="series-member-actions">
            <InForSeries note={`${nightsLabel(nights.length)}${last ? ` · through ${formatNightDate(last.startTime)}` : ''}`} />
            <div className="flex flex-wrap items-center gap-1.5">
                {statusToggle}
                <Button variant="secondary" size="sm" onClick={onSkip} loading={isSkipping} loadingLabel="Skipping this night" data-testid="skip-this-night">
                    Skip this night
                </Button>
                <LeaveSeriesButton event={event} state={state} />
            </div>
        </div>
    );
}

/** A member skipping this night: the muted note beside Sign Up, plus Leave series. */
export function SeriesSkippedNight({ event, state }: { event: EventResponseDto; state: SeriesSignupStateDto }): JSX.Element {
    const back = memberNights(state).length > 0 ? ' · back on the next night' : '';
    return (
        <div className="flex flex-wrap items-center gap-2" data-testid="series-skipped-night">
            <InForSeries note={`Skipping ${event.startTime ? formatNightDate(event.startTime) : 'this night'}${back}`} />
            <LeaveSeriesButton event={event} state={state} />
        </div>
    );
}
