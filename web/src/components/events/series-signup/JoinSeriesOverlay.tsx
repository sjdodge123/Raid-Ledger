import type { JSX } from 'react';
import type { EventResponseDto, SeriesSignupStateDto } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { Modal } from '../../ui/modal';
import { BottomSheet } from '../../ui/bottom-sheet';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { useMyCharacters } from '../../../hooks/use-characters';
import { useJoinSeries } from '../../../hooks/use-series-signup';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { JoinSeriesBody } from './JoinSeriesBody';
import { nightFor, nightsLabel } from './series-signup-format';
import { useJoinSeriesSelection } from './use-join-series-selection';

/**
 * The "Join series" overlay: `Modal` at ≥1024px, `BottomSheet` below (design
 * §4.4). The parent mounts it only while open, so a reopen starts fresh.
 */
export function JoinSeriesOverlay({ event, state, onClose }: {
    event: EventResponseDto; state: SeriesSignupStateDto; onClose: () => void;
}): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const gameId = event.game?.id ?? undefined;
    const { data, isLoading } = useMyCharacters(gameId, gameId !== undefined);
    const characters = data?.data ?? [];
    const hasRoles = event.game?.hasRoles ?? false;
    const selection = useJoinSeriesSelection(true, characters, hasRoles);
    const join = useJoinSeries(event.id);
    const tonight = nightFor(state, event.id)?.state;
    const title = `Join “${event.title}”`;
    const footer = (
        <>
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" data-testid="join-series-confirm" loading={join.isPending || isLoading}
                loadingLabel={isLoading ? 'Loading your characters' : 'Joining the series'}
                onClick={() => join.mutate(selection.dto, { onSuccess: onClose })}>
                {`Join ${nightsLabel(state.joinableCount)}`}
            </Button>
        </>
    );
    const body = (
        <JoinSeriesBody state={state} characters={characters} selection={selection} hasRoles={hasRoles}
            startsTonight={tonight === 'will_create' || tonight === 'will_attach'} />
    );
    if (isDesktop) return <Modal isOpen onClose={onClose} title={title} maxWidth="max-w-md" footer={footer}>{body}</Modal>;
    return <BottomSheet isOpen onClose={onClose} title={title} footer={footer}>{body}</BottomSheet>;
}
