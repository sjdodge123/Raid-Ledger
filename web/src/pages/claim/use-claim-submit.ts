/**
 * Form state + submit for the claim form (ROK-1701): the client-side guards
 * (empty code, password length/match) and the `useClaim` result → code status.
 */
import { useState, type FormEvent } from 'react';
import { SETUP_CLAIM_PASSWORD_MIN } from '@raid-ledger/contract';
import { useClaim } from './use-claim';
import type { CodeStatus } from './claim.helpers';

/** Everything `ClaimForm` renders from. */
export interface ClaimSubmitState {
    code: string; setCode: (v: string) => void;
    pw: string; setPw: (v: string) => void;
    confirm: string; setConfirm: (v: string) => void;
    status: CodeStatus;
    pwRefused: boolean;
    pending: boolean;
    onSubmit: (e: FormEvent) => void;
}

/** Owns the claim form's fields and submit; `expiredOnLoad` starts in the expired state. */
export function useClaimSubmit(expiredOnLoad: boolean): ClaimSubmitState {
    const claim = useClaim();
    const [code, setCode] = useState('');
    const [pw, setPw] = useState('');
    const [confirm, setConfirm] = useState('');
    const [status, setStatus] = useState<CodeStatus>(expiredOnLoad ? { kind: 'expired' } : { kind: 'idle' });
    const [pwRefused, setPwRefused] = useState(false);
    const onSubmit = (e: FormEvent): void => {
        e.preventDefault();
        if (!code.trim()) { setStatus({ kind: 'empty' }); return; }
        const pwOk = pw.length >= SETUP_CLAIM_PASSWORD_MIN && pw === confirm;
        setPwRefused(!pwOk);
        if (!pwOk) return;
        claim.mutate({ code, newPassword: pw }, {
            onSuccess: () => setStatus({ kind: 'ok' }),
            onError: (err) => setStatus(err.failure),
        });
    };
    return { code, setCode, pw, setPw, confirm, setConfirm, status, pwRefused, pending: claim.isPending, onSubmit };
}
