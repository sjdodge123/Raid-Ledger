/**
 * Backup confirms — the shared Modal (tech-debt [28]): dialog semantics, focus
 * trap, phone gutter, actions in the pinned footer.
 *
 * Modal has no switch to turn backdrop dismiss off (its backdrop, × and Escape
 * all call one close), so the typed-keyword confirms hand it a dirty-close
 * guard: once a keyword is typed, a stray tap or Escape asks "Discard your
 * changes?" instead of cancelling. The explicit Cancel stays a direct cancel.
 * While an action is pending nothing but its outcome closes the dialog.
 */
import { useState } from 'react';
import type { BackupFileDto } from '@raid-ledger/contract';
import { copyWithToast } from '../../lib/clipboard';
import { formatSize } from './backup-panel-utils';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { useDirtyCloseGuard } from '../../hooks/use-dirty-close-guard';

const KEYWORD_DISCARD = 'Closing now clears the confirmation keyword you typed.';
const PASSWORD_DISCARD = "The new admin password won't be shown again. Copy it before you leave for the login page.";
const noop = (): void => undefined;

/** Escape / backdrop / × do nothing while the action runs (Cancel is disabled too). */
function closeUnlessPending(onClose: () => void, isPending: boolean): () => void {
    return isPending ? noop : onClose;
}

export function DeleteModal({ backup, onClose, onConfirm, isPending }: {
    backup: BackupFileDto; onClose: () => void; onConfirm: () => void; isPending: boolean;
}) {
    return (
        <Modal isOpen onClose={closeUnlessPending(onClose, isPending)} title="Delete Backup"
            footer={<ModalActions onClose={onClose} onConfirm={onConfirm} isPending={isPending} confirmLabel="Delete" pendingLabel="Deleting..." />}>
            <p className="text-sm text-muted">
                Are you sure you want to delete <span className="font-mono text-foreground">{backup.filename}</span>? This cannot be undone.
            </p>
        </Modal>
    );
}

function ModalActions({ onClose, onConfirm, isPending, confirmLabel, pendingLabel, disabled }: {
    onClose: () => void; onConfirm: () => void; isPending: boolean; confirmLabel: string; pendingLabel: string; disabled?: boolean;
}) {
    return (
        <>
            <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button variant="destructive-soft" onClick={onConfirm} disabled={disabled} loading={isPending} loadingLabel={pendingLabel}>
                {confirmLabel}
            </Button>
        </>
    );
}

/** A typed-keyword confirm: the guard keeps a stray tap from cancelling it. */
function useKeywordConfirm(onClose: () => void, isPending: boolean) {
    const [confirmText, setConfirmText] = useState('');
    const closeGuard = useDirtyCloseGuard(confirmText !== '' && !isPending, closeUnlessPending(onClose, isPending));
    return { confirmText, setConfirmText, closeGuard };
}

export function RestoreModal({ backup, onClose, onConfirm, isPending }: {
    backup: BackupFileDto; onClose: () => void; onConfirm: () => void; isPending: boolean;
}) {
    const { confirmText, setConfirmText, closeGuard } = useKeywordConfirm(onClose, isPending);

    return (
        <Modal isOpen onClose={onClose} closeGuard={closeGuard} discardMessage={KEYWORD_DISCARD} maxWidth="max-w-lg"
            title="Restore from Backup"
            footer={<ModalActions onClose={onClose} onConfirm={onConfirm} isPending={isPending} disabled={confirmText !== 'RESTORE'}
                confirmLabel="Restore Database" pendingLabel="Restoring..." />}>
            <div className="space-y-4">
                <DestructiveWarning title="Warning: This is a destructive operation"
                    message="This will drop and recreate all database tables from the selected backup. A pre-restore safety snapshot will be created automatically." />
                <div className="text-sm text-muted">
                    <p>Restoring from: <span className="font-mono text-foreground">{backup.filename}</span></p>
                    <p>Type: <span className="text-foreground capitalize">{backup.type}</span> &middot; Size: <span className="text-foreground">{formatSize(backup.sizeBytes)}</span></p>
                </div>
                <ConfirmTextInput value={confirmText} onChange={setConfirmText} keyword="RESTORE" />
            </div>
        </Modal>
    );
}

export function ResetModal({ onClose, onConfirm, isPending, result }: {
    onClose: () => void; onConfirm: () => void; isPending: boolean; result: { password: string } | null;
}) {
    if (result) return <ResetResultView result={result} />;
    return <ResetConfirmView onClose={onClose} onConfirm={onConfirm} isPending={isPending} />;
}

function ResetConfirmView({ onClose, onConfirm, isPending }: {
    onClose: () => void; onConfirm: () => void; isPending: boolean;
}) {
    const { confirmText, setConfirmText, closeGuard } = useKeywordConfirm(onClose, isPending);

    return (
        <Modal isOpen onClose={onClose} closeGuard={closeGuard} discardMessage={KEYWORD_DISCARD} maxWidth="max-w-lg"
            title="Reset Instance"
            footer={<ModalActions onClose={onClose} onConfirm={onConfirm} isPending={isPending} disabled={confirmText !== 'RESET'}
                confirmLabel="Reset Instance" pendingLabel="Resetting..." />}>
            <div className="space-y-4">
                <DestructiveWarning title="This will permanently delete ALL data"
                    message="All users, events, characters, settings, and integrations will be wiped. A safety backup will be created automatically before the reset." />
                <ConfirmTextInput value={confirmText} onChange={setConfirmText} keyword="RESET" disabled={isPending} />
            </div>
        </Modal>
    );
}

function DestructiveWarning({ title, message }: { title: string; message: string }) {
    return (
        <div className="p-4 bg-danger/10 border border-danger/30 rounded-lg">
            <p className="text-sm text-danger font-medium">{title}</p>
            <p className="text-sm text-danger/80 mt-1">{message}</p>
        </div>
    );
}

function ConfirmTextInput({ value, onChange, keyword, disabled }: {
    value: string; onChange: (v: string) => void; keyword: string; disabled?: boolean;
}) {
    return (
        <Field label="Type the confirmation keyword"
            hint={<>Type <span className="font-mono text-foreground">{keyword}</span> to confirm</>}>
            <Input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={keyword} autoFocus disabled={disabled} />
        </Field>
    );
}

/** Every close path of the one-time password view leads to login — after a confirm. */
function goToLogin(): void {
    localStorage.removeItem('raid_ledger_token');
    localStorage.removeItem('raid_ledger_original_token');
    window.location.href = '/login';
}

function ResetResultView({ result }: { result: { password: string } }) {
    const [copied, setCopied] = useState(false);
    const closeGuard = useDirtyCloseGuard(true, goToLogin);
    const onCopy = (): void => {
        void copyWithToast(result.password, { error: 'Failed to copy password' }).then((ok) => {
            if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
        });
    };

    return (
        <Modal isOpen onClose={goToLogin} closeGuard={closeGuard} discardMessage={PASSWORD_DISCARD} maxWidth="max-w-lg"
            title="Instance Reset Complete" footer={<Button variant="secondary" onClick={goToLogin}>Go to Login</Button>}>
            <p className="text-sm text-muted">The instance has been reset to factory defaults. Use these credentials to log in:</p>
            <ResetCredentials password={result.password} copied={copied} onCopy={onCopy} />
        </Modal>
    );
}

function ResetCredentials({ password, copied, onCopy }: { password: string; copied: boolean; onCopy: () => void }) {
    return (
        <div className="mt-4 p-4 bg-backdrop border border-edge rounded-lg space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-sm text-muted">Email</span>
                <span className="font-mono text-sm text-foreground">admin@local</span>
            </div>
            <div className="flex items-center justify-between">
                <span className="text-sm text-muted">Password</span>
                <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-foreground">{password}</span>
                    <Button variant="ghost" size="sm" onClick={onCopy}>{copied ? 'Copied!' : 'Copy'}</Button>
                </div>
            </div>
        </div>
    );
}
