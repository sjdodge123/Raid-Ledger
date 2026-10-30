/**
 * Form state + submit for the claim form (ROK-1701): the client-side guards
 * (empty code, password length/match), the `useClaim` result → code status,
 * focus on the offending field, and the sign-in after the claim settles.
 */
import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { SETUP_CLAIM_PASSWORD_MIN } from '@raid-ledger/contract';
import { useClaim, useClaimSignIn } from './use-claim';
import type { CodeStatus } from './claim.helpers';

/** Everything `ClaimForm` renders from. */
export interface ClaimSubmitState {
    code: string; setCode: (v: string) => void;
    pw: string; setPw: (v: string) => void;
    confirm: string; setConfirm: (v: string) => void;
    status: CodeStatus;
    pwRefused: boolean;
    pending: boolean;
    /** False when the claim succeeded but the follow-up sign-in did not. */
    signedIn: boolean;
    codeRef: RefObject<HTMLInputElement | null>;
    pwRef: RefObject<HTMLInputElement | null>;
    onSubmit: (e: FormEvent) => void;
}

/** Password fields whose edits clear a previous refusal. */
function usePasswords(): Pick<ClaimSubmitState, 'pw' | 'setPw' | 'confirm' | 'setConfirm' | 'pwRefused'> & {
    setPwRefused: (v: boolean) => void;
} {
    const [pw, setPwRaw] = useState('');
    const [confirm, setConfirmRaw] = useState('');
    const [pwRefused, setPwRefused] = useState(false);
    const setPw = (v: string): void => { setPwRaw(v); setPwRefused(false); };
    const setConfirm = (v: string): void => { setConfirmRaw(v); setPwRefused(false); };
    return { pw, setPw, confirm, setConfirm, pwRefused, setPwRefused };
}

/** Owns the claim form's fields and submit; `expiredOnLoad` starts in the expired state. */
export function useClaimSubmit(expiredOnLoad: boolean): ClaimSubmitState {
    const claim = useClaim();
    const { signingIn, signIn } = useClaimSignIn();
    const { setPwRefused, ...passwords } = usePasswords();
    const [code, setCode] = useState('');
    const [status, setStatus] = useState<CodeStatus>(expiredOnLoad ? { kind: 'expired' } : { kind: 'idle' });
    const [signedIn, setSignedIn] = useState(true);
    const codeRef = useRef<HTMLInputElement | null>(null);
    const pwRef = useRef<HTMLInputElement | null>(null);
    const onSubmit = (e: FormEvent): void => {
        e.preventDefault();
        if (!code.trim()) { setStatus({ kind: 'empty' }); codeRef.current?.focus(); return; }
        const pwOk = passwords.pw.length >= SETUP_CLAIM_PASSWORD_MIN && passwords.pw === passwords.confirm;
        setPwRefused(!pwOk);
        if (!pwOk) { pwRef.current?.focus(); return; }
        claim.mutate({ code, newPassword: passwords.pw }, {
            onSuccess: (token) => { void signIn(token).then((ok) => { setSignedIn(ok); setStatus({ kind: 'ok' }); }); },
            onError: (err) => { setStatus(err.failure); codeRef.current?.focus(); },
        });
    };
    const pending = claim.isPending || signingIn;
    return { code, setCode, ...passwords, status, pending, signedIn, codeRef, pwRef, onSubmit };
}
