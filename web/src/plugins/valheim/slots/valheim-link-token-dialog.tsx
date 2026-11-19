/**
 * Show-once token dialog (ROK-1833). The raw token arrives as a prop from the
 * control's state and is never stored anywhere else; closing the dialog drops
 * it. Until it is copied, every close path asks "Leave without copying the
 * token?". Built on the shared `ShowOnceSecretDialog` (ROK-2263); this file
 * adds only the Server ID field and the mod setup notes.
 */
import type { JSX } from 'react';
import type { ValheimLinkTokenIssued } from '@raid-ledger/contract';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { CopyButton } from '../../../components/ui/CopyButton';
import { ShowOnceSecretDialog } from '../../../components/ui/show-once-secret-dialog';
import { ValheimModInstructions } from './valheim-mod-instructions';

const DISCARD_MESSAGE = "This token won't be shown again. Copy it before you leave, or rotate it later.";

interface DialogProps {
    issued: ValheimLinkTokenIssued;
    serverName: string;
    onClose: () => void;
}

/** See file docstring. */
export function ValheimLinkTokenDialog({ issued, serverName, onClose }: DialogProps): JSX.Element {
    const serverIdField = (
        <Field label="Server ID">
            <Input readOnly value={issued.serverId} data-testid="valheim-link-server-id"
                trailing={<CopyButton text={issued.serverId} />} />
        </Field>
    );
    return (
        <ShowOnceSecretDialog title={`Mod token for ${serverName}`} secret={issued.token} onClose={onClose}
            discardMessage={DISCARD_MESSAGE} leading={serverIdField} testIdPrefix="valheim-link-token">
            {(markCopied) => (
                <ValheimModInstructions serverId={issued.serverId} token={issued.token} onCopied={markCopied} />
            )}
        </ShowOnceSecretDialog>
    );
}
