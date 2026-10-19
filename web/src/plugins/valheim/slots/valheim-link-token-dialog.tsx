/**
 * Show-once token dialog (ROK-1833). The raw token arrives as a prop from the
 * control's state and is never stored anywhere else; closing the dialog drops
 * it. Until it is copied, every close path asks "Leave without copying the
 * token?" (the `PASSWORD_DISCARD_COPY` idiom from the backup reset view).
 */
import { useState, type JSX } from 'react';
import type { ValheimLinkTokenIssued } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { PasswordInput } from '../../../components/ui/password-input';
import { CopyButton } from '../../../components/ui/CopyButton';
import { useDirtyCloseGuard } from '../../../hooks/use-dirty-close-guard';
import { copyWithToast } from '../../../lib/clipboard';
import { ValheimOverlay } from './valheim-overlay';
import { ValheimModInstructions } from './valheim-mod-instructions';

const DISCARD_MESSAGE = "This token won't be shown again. Copy it before you leave, or rotate it later.";
const DISCARD_COPY = { title: 'Leave without copying the token?', keepLabel: 'Stay', discardLabel: 'Leave' } as const;

interface DialogProps {
    issued: ValheimLinkTokenIssued;
    serverName: string;
    onClose: () => void;
}

/** See file docstring. */
export function ValheimLinkTokenDialog({ issued, serverName, onClose }: DialogProps): JSX.Element {
    const [copied, setCopied] = useState(false);
    const closeGuard = useDirtyCloseGuard(!copied, onClose);
    const onCopy = (): void => {
        void copyWithToast(issued.token, { error: 'Failed to copy the token' }).then((ok) => { if (ok) setCopied(true); });
    };
    const footer = <Button variant="secondary" onClick={closeGuard.requestClose}>Done</Button>;
    return (
        <ValheimOverlay title={`Mod token for ${serverName}`} onClose={onClose} footer={footer}
            closeGuard={closeGuard} discardMessage={DISCARD_MESSAGE} discardCopy={DISCARD_COPY}>
            <div className="space-y-4" data-testid="valheim-link-token-dialog">
                <div role="status" className="p-3 rounded-lg border bg-warning/10 border-warning/30 text-sm text-warning">
                    This token is shown once. Copy it now — Raid Ledger keeps only a fingerprint.
                </div>
                <Field label="Server ID">
                    <Input readOnly value={issued.serverId} data-testid="valheim-link-server-id"
                        trailing={<CopyButton text={issued.serverId} />} />
                </Field>
                <Field label="Token">
                    <PasswordInput label="token" readOnly value={issued.token} data-testid="valheim-link-token-value" />
                </Field>
                <Button variant="secondary" size="sm" onClick={onCopy} data-testid="valheim-link-token-copy">
                    {copied ? 'Copied' : 'Copy token'}
                </Button>
                <ValheimModInstructions serverId={issued.serverId} token={issued.token} />
            </div>
        </ValheimOverlay>
    );
}
