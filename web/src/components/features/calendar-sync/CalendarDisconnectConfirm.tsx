/**
 * Disconnect confirm (ROK-1594): `Modal` at 1024px and up, `BottomSheet`
 * below (design-system §4.4), `destructive` confirm. A failed DELETE shows
 * inline beside the actions — never a toast (§4.8).
 */
import type { JSX } from 'react';
import { Modal } from '../../ui/modal';
import { BottomSheet } from '../../ui/bottom-sheet';
import { Button } from '../../ui/button';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { CALENDARS_COPY as C } from './calendar-sync.copy';

export interface CalendarDisconnectConfirmProps {
    isOpen: boolean;
    accountLabel: string | null;
    isPending: boolean;
    failed: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

function ConfirmActions(props: CalendarDisconnectConfirmProps): JSX.Element {
    return (
        <>
            <Button variant="secondary" onClick={props.onCancel} disabled={props.isPending}
                data-testid="calendar-disconnect-cancel">
                {C.confirmCancel}
            </Button>
            <Button variant="destructive" onClick={props.onConfirm} loading={props.isPending}
                loadingLabel={C.disconnecting} data-testid="calendar-disconnect-confirm">
                {C.disconnect}
            </Button>
        </>
    );
}

function ConfirmBody({ accountLabel, failed }: CalendarDisconnectConfirmProps): JSX.Element {
    return (
        <div className="space-y-2" data-testid="calendar-disconnect-dialog">
            {accountLabel && <p className="text-sm font-medium text-foreground">{accountLabel}</p>}
            <p className="text-sm text-secondary">{C.confirmBody}</p>
            {failed && <p role="alert" className="text-sm text-danger">{C.disconnectFailed}</p>}
        </div>
    );
}

export function CalendarDisconnectConfirm(props: CalendarDisconnectConfirmProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const footer = <ConfirmActions {...props} />;
    if (isDesktop) {
        return (
            <Modal isOpen={props.isOpen} onClose={props.onCancel} title={C.confirmTitle} footer={footer}>
                <ConfirmBody {...props} />
            </Modal>
        );
    }
    return (
        <BottomSheet isOpen={props.isOpen} onClose={props.onCancel} title={C.confirmTitle} footer={footer}>
            <ConfirmBody {...props} />
        </BottomSheet>
    );
}
