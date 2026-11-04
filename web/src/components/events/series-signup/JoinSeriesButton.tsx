import { useState, type JSX } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import type { EventResponseDto } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { useSeriesSignupState } from '../../../hooks/use-series-signup';
import { JoinSeriesOverlay } from './JoinSeriesOverlay';
import { isSeriesJoinCandidate, isSeriesMember, nightFor } from './series-signup-format';

/**
 * "Join series", beside Sign Up or Leave. Hidden for a one-off event, a
 * cancelled or past night, a series member, and when no night is left to join.
 */
export function JoinSeriesButton({ event, size }: { event: EventResponseDto; size?: 'sm' | undefined }): JSX.Element | null {
    const [open, setOpen] = useState(false);
    const candidate = isSeriesJoinCandidate(event);
    const { data: state } = useSeriesSignupState(event.id, candidate);
    if (!candidate || !state || isSeriesMember(state) || state.joinableCount === 0 || !nightFor(state, event.id)) return null;
    return (
        <>
            <Button variant="secondary" size={size} onClick={() => setOpen(true)} data-testid="join-series-button">
                <ArrowPathIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
                Join series
            </Button>
            {open && <JoinSeriesOverlay event={event} state={state} onClose={() => setOpen(false)} />}
        </>
    );
}
