/**
 * K3 Apple connect (ROK-1598): `Modal` at 1024px and up, `BottomSheet` below
 * (design-system §4.4, as `CalendarDisconnectConfirm`). Composes the two
 * primitives by breakpoint — no new pattern.
 *
 * The password is sent once: it lives in the draft state (wiped on every
 * open/close edge) and in the mutation's `variables` only while the request is
 * in flight — a refusal copies its `failure` into local state and calls
 * `reset()` at once, as do `close()` and success; the hook's `gcTime: 0` drops it.
 * A half-typed form asks before discarding (§4.4 dirty-close).
 */
import { useId, useState, type JSX } from 'react';
import { toast } from 'sonner';
import type { AppleConnectInput, CalendarConnection } from '@raid-ledger/contract';
import { Modal } from '../../ui/modal';
import { BottomSheet } from '../../ui/bottom-sheet';
import { Button } from '../../ui/button';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { useDirtyCloseGuard, type DirtyCloseGuard } from '../../../hooks/use-dirty-close-guard';
import { useConnectApple, type AppleConnectFailure } from '../../../hooks/use-calendar-sync';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { APPLE_CONNECT_COPY as A } from './apple-connect.copy';
import { AppleConnectForm } from './AppleConnectForm';
import { useAppleConnectDraft } from './use-apple-connect-draft';

export interface AppleConnectSheetProps {
    isOpen: boolean;
    onClose: () => void;
    /** `reconnect` prefills the email from `connection.accountLabel` and retitles the sheet. */
    mode: 'connect' | 'reconnect';
    connection?: CalendarConnection | undefined;
}

function Actions({ formId, guard, pending, canSubmit }: {
    formId: string; guard: DirtyCloseGuard; pending: boolean; canSubmit: boolean;
}): JSX.Element {
    return (
        <>
            <Button variant="secondary" onClick={guard.requestClose} data-testid="apple-connect-cancel">
                {A.cancel}
            </Button>
            <Button type="submit" form={formId} disabled={!canSubmit} loading={pending}
                loadingLabel={A.connecting} data-testid="apple-connect-submit">
                {A.connect}
            </Button>
        </>
    );
}

/** Draft + mutation + the one close path every exit shares. */
function useAppleConnectFlow({ isOpen, onClose, mode, connection }: AppleConnectSheetProps) {
    const initialEmail = mode === 'reconnect' ? connection?.accountLabel ?? '' : '';
    const draft = useAppleConnectDraft(isOpen, initialEmail);
    const connect = useConnectApple();
    const [failure, setFailure] = useState<AppleConnectFailure | null>(null);
    const close = (): void => {
        draft.clearPassword();
        setFailure(null);
        connect.reset();
        onClose();
    };
    const guard = useDirtyCloseGuard(draft.dirty, close);
    const submit = (input: AppleConnectInput): void => {
        setFailure(null);
        connect.mutate(input, {
            onSuccess: () => { toast.success(A.toastConnected); close(); },
            onError: (err) => {
                // Keep only the failure: `reset()` drops the input (email + password) from `variables`.
                setFailure(err.failure);
                if (err.failure === 'apple_auth_failed') draft.clearPassword();
                connect.reset();
            },
        });
    };
    return { draft, connect, failure, guard, submit };
}

export function AppleConnectSheet(props: AppleConnectSheetProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const formId = useId();
    const { draft, connect, failure, guard, submit } = useAppleConnectFlow(props);
    const title = props.mode === 'reconnect' ? A.titleReconnect : A.titleConnect;
    const footer = <Actions formId={formId} guard={guard} pending={connect.isPending} canSubmit={draft.input !== null} />;
    const body = (
        <AppleConnectForm formId={formId} draft={draft} failure={failure} onSubmit={submit} />
    );
    if (isDesktop) {
        return (
            <Modal isOpen={props.isOpen} onClose={guard.requestClose} title={title} footer={footer}
                closeGuard={guard} discardMessage={A.discardMessage}>
                {body}
            </Modal>
        );
    }
    return (
        <BottomSheet isOpen={props.isOpen} onClose={guard.requestClose} title={title} footer={footer}
            closeGuard={guard} discardMessage={A.discardMessage} maxHeight="85vh">
            {body}
        </BottomSheet>
    );
}
