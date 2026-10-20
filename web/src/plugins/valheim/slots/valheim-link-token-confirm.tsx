/** Rotate / Revoke confirm (ROK-1833): both cut the mod off at once, so neither runs on one tap. */
import type { JSX } from 'react';
import { Button } from '../../../components/ui/button';
import { ValheimOverlay } from './valheim-overlay';

export type TokenConfirmKind = 'rotate' | 'revoke';

interface ConfirmCopy { title: string; action: string; pending: string; body: (name: string) => string; note?: string }

const COPY: Record<TokenConfirmKind, ConfirmCopy> = {
    rotate: {
        title: 'Rotate the mod token?', action: 'Rotate token', pending: 'Rotating…',
        body: (name) => `The current token for ${name} stops working immediately. The mod stops uploading until you paste the new token into its config.`,
        note: 'The old token stops working immediately — see the setup notes in the token dialog.',
    },
    revoke: {
        title: 'Revoke the mod token?', action: 'Revoke token', pending: 'Revoking…',
        body: (name) => `The token for ${name} stops working immediately and the mod stops uploading. You can generate a new one later.`,
    },
};

interface ConfirmProps {
    kind: TokenConfirmKind;
    serverName: string;
    isPending: boolean;
    onConfirm: () => void;
    onClose: () => void;
}

/** Cancel closes; while the call runs nothing but its outcome closes the confirm. */
export function ValheimLinkTokenConfirm({ kind, serverName, isPending, onConfirm, onClose }: ConfirmProps): JSX.Element {
    const copy = COPY[kind];
    const close = isPending ? (): void => undefined : onClose;
    const footer = (
        <>
            <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button variant={kind === 'rotate' ? 'warning-soft' : 'destructive-soft'} onClick={onConfirm}
                loading={isPending} loadingLabel={copy.pending} data-testid={`valheim-link-token-confirm-${kind}`}>
                {copy.action}
            </Button>
        </>
    );
    return (
        <ValheimOverlay title={copy.title} onClose={close} footer={footer}>
            <p className="text-sm text-secondary">{copy.body(serverName)}</p>
            {copy.note !== undefined && <p className="mt-2 text-sm text-muted">{copy.note}</p>}
        </ValheimOverlay>
    );
}
