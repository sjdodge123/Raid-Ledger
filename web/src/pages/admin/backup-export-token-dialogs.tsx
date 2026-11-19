/**
 * ROK-2263 — clone access token dialogs: the mint `Modal` (label + expiry),
 * the show-once step (`ShowOnceSecretDialog`, mounted only while a plaintext
 * token exists) and the revoke confirm.
 */
import { useState, type FormEvent, type JSX } from 'react';
import {
    BACKUP_EXPORT_TOKEN_DEFAULT_EXPIRY_DAYS,
    BACKUP_EXPORT_TOKEN_EXPIRY_DAYS,
    type BackupExportToken,
    type BackupExportTokenExpiry,
    type MintBackupExportTokenResponse,
} from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { Select } from '../../components/ui/select';
import { ShowOnceSecretDialog } from '../../components/ui/show-once-secret-dialog';
import { toast } from '../../lib/toast';
import { useMintBackupExportToken, useRevokeBackupExportToken } from '../../hooks/use-backup-export-tokens';

const LABEL_MAX = 60;
const NEVER = 'never';
const MINT_FORM_ID = 'backup-export-token-mint-form';
const noop = (): void => undefined;

/** "90" → 90, "never" → null; anything unexpected falls back to the default. */
function parseExpiry(value: string): BackupExportTokenExpiry {
    if (value === NEVER) return null;
    const days = BACKUP_EXPORT_TOKEN_EXPIRY_DAYS.find((d) => String(d) === value);
    return days ?? BACKUP_EXPORT_TOKEN_DEFAULT_EXPIRY_DAYS;
}

function expiryLabel(days: BackupExportTokenExpiry): string {
    return days === null ? 'Never expires' : `${days} days`;
}

function MintFooter({ onClose, isPending, canSubmit }: { onClose: () => void; isPending: boolean; canSubmit: boolean }): JSX.Element {
    return (
        <>
            <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" form={MINT_FORM_ID} disabled={!canSubmit} loading={isPending} loadingLabel="Creating..."
                data-testid="backup-export-token-mint-submit">
                Create token
            </Button>
        </>
    );
}

/** Mint form. On success the parent closes it and shows the token once. */
export function MintTokenModal({ onClose, onMinted }: {
    onClose: () => void; onMinted: (res: MintBackupExportTokenResponse) => void;
}): JSX.Element {
    const mint = useMintBackupExportToken();
    const [label, setLabel] = useState('');
    const [expiry, setExpiry] = useState(String(BACKUP_EXPORT_TOKEN_DEFAULT_EXPIRY_DAYS));
    const trimmed = label.trim();
    const submit = (e: FormEvent): void => {
        e.preventDefault();
        if (!trimmed || mint.isPending) return;
        mint.mutate({ label: trimmed, expiresInDays: parseExpiry(expiry) }, { onSuccess: onMinted });
    };
    return (
        <Modal isOpen onClose={mint.isPending ? noop : onClose} title="New clone access token"
            footer={<MintFooter onClose={onClose} isPending={mint.isPending} canSubmit={trimmed.length > 0} />}>
            <form id={MINT_FORM_ID} onSubmit={submit} className="space-y-4" data-testid="backup-export-token-mint-form">
                <Field label="Label" hint="Where the token will be used, e.g. “Laptop clone script”." required>
                    <Input value={label} maxLength={LABEL_MAX} autoFocus onChange={(e) => setLabel(e.target.value)} />
                </Field>
                <Field label="Expires">
                    <Select value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                        {BACKUP_EXPORT_TOKEN_EXPIRY_DAYS.map((d) => <option key={d} value={String(d)}>{expiryLabel(d)}</option>)}
                        <option value={NEVER}>{expiryLabel(null)}</option>
                    </Select>
                </Field>
                {mint.error && <p role="alert" className="text-sm text-danger">{mint.error.message}</p>}
            </form>
        </Modal>
    );
}

/** The one-time view of a freshly minted token. Mount only while `minted` exists. */
export function MintedTokenDialog({ minted, onClose }: { minted: MintBackupExportTokenResponse; onClose: () => void }): JSX.Element {
    return (
        <ShowOnceSecretDialog title="Clone access token created" secret={minted.token} onClose={onClose}
            testIdPrefix="backup-export-token-secret"
            leading={<p className="text-sm text-muted">Label: <span className="text-foreground">{minted.item.label}</span></p>} />
    );
}

/** Revoke confirm: the token stops working at once; the row stays listed as revoked. */
export function RevokeTokenModal({ token, onClose }: { token: BackupExportToken; onClose: () => void }): JSX.Element {
    const revoke = useRevokeBackupExportToken();
    const confirm = (): void => {
        revoke.mutate(token.id, {
            onSuccess: () => { toast.success(`Revoked “${token.label}”`); onClose(); },
            onError: (err) => toast.error(err.message),
        });
    };
    return (
        <Modal isOpen onClose={revoke.isPending ? noop : onClose} title="Revoke clone access token"
            footer={(
                <>
                    <Button variant="secondary" onClick={onClose} disabled={revoke.isPending}>Cancel</Button>
                    <Button variant="destructive-soft" onClick={confirm} loading={revoke.isPending} loadingLabel="Revoking..."
                        data-testid="backup-export-token-revoke-confirm">
                        Revoke
                    </Button>
                </>
            )}>
            <p className="text-sm text-muted">
                Scripts using <span className="text-foreground font-medium">{token.label}</span>{' '}
                <span className="font-mono">…{token.tokenHint}</span> will stop working right away. This cannot be undone.
            </p>
        </Modal>
    );
}
