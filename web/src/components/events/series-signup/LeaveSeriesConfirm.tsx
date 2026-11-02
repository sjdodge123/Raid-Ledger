import type { JSX } from 'react';
import type { SeriesNightDto } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { Modal } from '../../ui/modal';
import { BottomSheet } from '../../ui/bottom-sheet';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { formatNightDate, lateCancelNight, nightsLabel } from './series-signup-format';

/** The Leave-series confirm: names the nights it removes and flags a late cancel (<23h). */
export function LeaveSeriesConfirm({ seriesTitle, nights, isPending, onClose, onConfirm }: {
    seriesTitle: string; nights: readonly SeriesNightDto[]; isPending: boolean; onClose: () => void; onConfirm: () => void;
}): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const first = nights[0];
    const last = nights[nights.length - 1];
    const late = lateCancelNight(nights);
    const title = `Leave “${seriesTitle}”?`;
    const footer = (
        <>
            <Button variant="secondary" size="sm" onClick={onClose}>Stay in series</Button>
            <Button variant="destructive" size="sm" data-testid="leave-series-confirm" loading={isPending} loadingLabel="Leaving the series" onClick={onConfirm}>
                Leave series
            </Button>
        </>
    );
    const body = (
        <div className="space-y-3 text-sm">
            <p className="text-foreground">
                You&apos;ll be taken off the {nightsLabel(nights.length)} you&apos;re signed up for
                {first && last ? ` (${formatNightDate(first.startTime)} → ${formatNightDate(last.startTime)})` : ''}.
            </p>
            {late && (
                <p className="text-warning" data-testid="leave-series-late-warning">
                    {formatNightDate(late.startTime)} is less than 23 hours away, so leaving now counts as a late cancel for it
                    — the same rule as leaving any night under 23 hours out.
                </p>
            )}
            <p className="text-muted">Past nights stay as they are. To miss just one night, use Skip this night.</p>
        </div>
    );
    if (isDesktop) return <Modal isOpen onClose={onClose} title={title} maxWidth="max-w-md" footer={footer}>{body}</Modal>;
    return <BottomSheet isOpen onClose={onClose} title={title} footer={footer}>{body}</BottomSheet>;
}
