/**
 * Subscribe link reset confirm (ROK-1599) — the `CalendarDisconnectConfirm`
 * shape: `Modal` at 1024px and up, `BottomSheet` below (design-system §4.4),
 * `destructive` confirm. A failed POST shows inline — never a toast (§4.8).
 */
import type { JSX } from 'react';
import { Modal } from '../../ui/modal';
import { BottomSheet } from '../../ui/bottom-sheet';
import { Button } from '../../ui/button';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { FEED_COPY as F } from './calendar-feed.copy';

export interface SubscribeLinkResetConfirmProps {
    isOpen: boolean;
    isPending: boolean;
    failed: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

function ConfirmActions(props: SubscribeLinkResetConfirmProps): JSX.Element {
    return (
        <>
            <Button variant="secondary" onClick={props.onCancel} disabled={props.isPending}
                data-testid="calendar-feed-reset-cancel">
                {F.confirmCancel}
            </Button>
            <Button variant="destructive" onClick={props.onConfirm} loading={props.isPending}
                loadingLabel={F.resetting} data-testid="calendar-feed-reset-confirm">
                {F.confirmReset}
            </Button>
        </>
    );
}

function ConfirmBody({ failed }: SubscribeLinkResetConfirmProps): JSX.Element {
    return (
        <div className="space-y-2" data-testid="calendar-feed-reset-dialog">
            <p className="text-sm text-secondary">{F.confirmBody}</p>
            {failed && <p role="alert" className="text-sm text-danger">{F.resetFailed}</p>}
        </div>
    );
}

export function SubscribeLinkResetConfirm(props: SubscribeLinkResetConfirmProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const footer = <ConfirmActions {...props} />;
    if (isDesktop) {
        return (
            <Modal isOpen={props.isOpen} onClose={props.onCancel} title={F.confirmTitle} footer={footer}>
                <ConfirmBody {...props} />
            </Modal>
        );
    }
    return (
        <BottomSheet isOpen={props.isOpen} onClose={props.onCancel} title={F.confirmTitle} footer={footer}>
            <ConfirmBody {...props} />
        </BottomSheet>
    );
}
