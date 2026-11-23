/**
 * ShowOnceSecretDialog — the show-once secret dialog (ROK-2263, extracted from
 * the Valheim mod-token dialog of ROK-1833). The secret arrives as a prop from
 * the caller's state and is never stored anywhere else; the caller mounts the
 * dialog only while it should be open, so closing it drops the secret.
 *
 * Until the secret is copied, every close path (×, Escape, backdrop, swipe,
 * Done) asks "Leave without copying the token?" / Stay / Leave
 * (`useDirtyCloseGuard`, the backup reset idiom). `Modal` at ≥1024px,
 * `BottomSheet` below (§4.4, `DESKTOP_MQ`). Tokens only — the banner is the
 * §4.7 `warning` callout.
 */
import { useState, type JSX, type ReactNode } from 'react';
import { Modal } from './modal';
import { BottomSheet } from './bottom-sheet';
import { Button } from './button';
import { Field } from './field';
import { PasswordInput } from './password-input';
import type { DiscardCopy } from './discard-changes-confirm';
import { useDirtyCloseGuard } from '../../hooks/use-dirty-close-guard';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { copyWithToast } from '../../lib/clipboard';

const SHOW_ONCE_DEFAULT_EXPLAINER = 'This token is shown once. Copy it now — Raid Ledger keeps only a fingerprint.';
const SHOW_ONCE_DEFAULT_DISCARD_MESSAGE = "This token won't be shown again.";
const SHOW_ONCE_DEFAULT_DISCARD_COPY: DiscardCopy = {
    title: 'Leave without copying the token?', keepLabel: 'Stay', discardLabel: 'Leave',
};

export interface ShowOnceSecretDialogProps {
    /** Dialog title, e.g. "Mod token for <server>". */
    title: string;
    /** The plaintext secret. Held only by the caller's state. */
    secret: string;
    /** Called when the dialog closes for real (after the guard, if not yet copied). */
    onClose: () => void;
    /** The warning banner's text. Defaults to `SHOW_ONCE_DEFAULT_EXPLAINER`. */
    explainer?: ReactNode;
    /** The secret field's label; its lowercase names the reveal toggle ("Show token"). Default "Token". */
    secretLabel?: string;
    /** The copy button's label before a copy. Default "Copy token". */
    copyLabel?: string;
    /** Discard-guard message. Defaults to `SHOW_ONCE_DEFAULT_DISCARD_MESSAGE`. */
    discardMessage?: string;
    /** Discard-guard title + labels (Modal and BottomSheet). Defaults to `SHOW_ONCE_DEFAULT_DISCARD_COPY`. */
    discardCopy?: DiscardCopy;
    /** Content above the secret field (e.g. a read-only id with its own `CopyButton`). */
    leading?: ReactNode;
    /** Content below the copy button. A function gets `markCopied` for a second copy path. */
    children?: ReactNode | ((markCopied: () => void) => ReactNode);
    /** `data-testid` prefix: `<p>-dialog`, `<p>-value`, `<p>-copy`. Default "show-once-secret". */
    testIdPrefix?: string;
}

interface OverlayProps {
    title: string;
    onClose: () => void;
    footer: ReactNode;
    children: ReactNode;
    guard: ReturnType<typeof useDirtyCloseGuard>;
    discardMessage: string;
    discardCopy: DiscardCopy;
}

/** Modal at ≥1024px, BottomSheet below — the caller mounts it only while open. */
function ShowOnceOverlay({ guard, discardCopy, ...props }: OverlayProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    if (isDesktop) {
        return <Modal isOpen {...props} closeGuard={guard} discardCopy={discardCopy} maxWidth="max-w-lg" />;
    }
    return <BottomSheet isOpen {...props} closeGuard={guard} discardCopy={discardCopy} />;
}

/** See file docstring. */
export function ShowOnceSecretDialog(props: ShowOnceSecretDialogProps): JSX.Element {
    const { title, secret, onClose, secretLabel = 'Token', copyLabel = 'Copy token', testIdPrefix = 'show-once-secret' } = props;
    const [copied, setCopied] = useState(false);
    const guard = useDirtyCloseGuard(!copied, onClose);
    const markCopied = (): void => setCopied(true);
    const onCopy = (): void => {
        void copyWithToast(secret, { error: `Failed to copy the ${secretLabel.toLowerCase()}` }).then((ok) => { if (ok) markCopied(); });
    };
    const footer = <Button variant="secondary" onClick={guard.requestClose}>Done</Button>;
    const extras = typeof props.children === 'function' ? props.children(markCopied) : props.children;
    return (
        <ShowOnceOverlay title={title} onClose={onClose} footer={footer} guard={guard}
            discardMessage={props.discardMessage ?? SHOW_ONCE_DEFAULT_DISCARD_MESSAGE}
            discardCopy={props.discardCopy ?? SHOW_ONCE_DEFAULT_DISCARD_COPY}>
            <div className="space-y-4" data-testid={`${testIdPrefix}-dialog`}>
                <div role="status" className="p-3 rounded-lg border bg-warning/10 border-warning/30 text-sm text-warning">
                    {props.explainer ?? SHOW_ONCE_DEFAULT_EXPLAINER}
                </div>
                {props.leading}
                <Field label={secretLabel}>
                    <PasswordInput label={secretLabel.toLowerCase()} readOnly value={secret} data-testid={`${testIdPrefix}-value`} />
                </Field>
                <Button variant="secondary" size="sm" onClick={onCopy} data-testid={`${testIdPrefix}-copy`}>
                    {copied ? 'Copied' : copyLabel}
                </Button>
                {extras}
            </div>
        </ShowOnceOverlay>
    );
}
