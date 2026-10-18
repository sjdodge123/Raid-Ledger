/**
 * State for one row's token control (ROK-1833): which confirm is open, the
 * freshly issued token (component state only — the mutation is reset as soon
 * as its result is captured), and the inline error.
 */
import { useState } from 'react';
import type { ValheimLinkTokenIssued } from '@raid-ledger/contract';
import { useIssueValheimLinkToken, useRevokeValheimLinkToken } from '../hooks/use-valheim-link-tokens';
import { tokenErrorMessage } from './valheim-link-token.helpers';
import type { TokenConfirmKind } from './valheim-link-token-confirm';

export interface TokenActions {
    confirm: TokenConfirmKind | null;
    issued: ValheimLinkTokenIssued | null;
    error: string | null;
    isPending: boolean;
    generate: () => void;
    ask: (kind: TokenConfirmKind) => void;
    runConfirm: () => void;
    closeConfirm: () => void;
    closeDialog: () => void;
}

/** See file docstring. */
export function useValheimTokenActions(pelicanServerId: number): TokenActions {
    const [confirm, setConfirm] = useState<TokenConfirmKind | null>(null);
    const [issued, setIssued] = useState<ValheimLinkTokenIssued | null>(null);
    const [error, setError] = useState<string | null>(null);
    const issue = useIssueValheimLinkToken();
    const revoke = useRevokeValheimLinkToken();
    const fail = (err: unknown): void => { setConfirm(null); setError(tokenErrorMessage(err)); };
    const runIssue = (rotate: boolean): void => {
        setError(null);
        issue.mutate({ pelicanServerId, rotate }, {
            onSuccess: (data) => { setConfirm(null); setIssued(data); issue.reset(); },
            onError: fail,
        });
    };
    const runConfirm = (): void => {
        if (confirm === 'rotate') { runIssue(true); return; }
        setError(null);
        revoke.mutate(pelicanServerId, { onSuccess: () => setConfirm(null), onError: fail });
    };
    return {
        confirm, issued, error, isPending: issue.isPending || revoke.isPending,
        generate: () => runIssue(false), ask: setConfirm, runConfirm,
        closeConfirm: () => setConfirm(null), closeDialog: () => setIssued(null),
    };
}
