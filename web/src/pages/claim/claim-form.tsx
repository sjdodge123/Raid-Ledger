/**
 * The claim form (ROK-1701, approved claim sheet C4/C5): setup code, fixed
 * sign-in name, new + confirm password with one "Show passwords" control,
 * and the submit → server result states. Inventory primitives only.
 */
import { useId, useState, type JSX, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { PasswordInput } from '../../components/ui/password-input';
import { Checkbox } from '../../components/ui/checkbox';
import { Button } from '../../components/ui/button';
import { buttonClass } from '../../components/ui/button-classes';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useClaimSubmit } from './use-claim-submit';
import { ClaimStrengthMeter } from './claim-strength-meter';
import {
    PASSWORD_GUARD_MESSAGE, PASSWORD_MISMATCH_MESSAGE, PASSWORD_TOO_LONG_MESSAGE, TONE_TEXT, codeMessage,
    isPasswordTooLong, isPasswordValid, passwordStrength, strengthHint, type CodeStatus,
} from './claim.helpers';

function CodeMessage({ id, status, checking }: { id: string; status: CodeStatus; checking: boolean }): JSX.Element {
    if (checking) {
        return <p id={id} className="mt-1 min-h-5 text-sm text-muted flex items-center gap-2"><ArrowPathIcon className="w-4 h-4 animate-spin" aria-hidden="true" />Checking the code…</p>;
    }
    const msg = codeMessage(status);
    const icon = msg.tone === 'danger' ? '✕' : msg.tone === 'success' ? '✓' : '';
    return (
        <p id={id} role={msg.alert ? 'alert' : undefined} className={`mt-1 min-h-5 text-sm flex gap-1.5 ${TONE_TEXT[msg.tone]}`} data-testid="claim-code-message" data-state={status.kind}>
            {icon && <span aria-hidden="true">{icon}</span>}<span>{msg.text}</span>
        </p>
    );
}

function PasswordFields({ pw, confirm, setPw, setConfirm, refused, pwRef }: {
    pw: string; confirm: string; setPw: (v: string) => void; setConfirm: (v: string) => void;
    refused: boolean; pwRef: RefObject<HTMLInputElement | null>;
}): JSX.Element {
    const [revealed, setRevealed] = useState(false);
    const level = passwordStrength(pw);
    const hint = strengthHint(level);
    const mismatch = confirm.length > 0 && confirm !== pw;
    return (
        <>
            <Field label="New password" hint={<span className={TONE_TEXT[hint.tone]}>{hint.text}</span>}
                error={refused ? (isPasswordTooLong(pw) ? PASSWORD_TOO_LONG_MESSAGE : PASSWORD_GUARD_MESSAGE) : undefined}>
                <PasswordInput ref={pwRef} label="new password" autoComplete="new-password" value={pw} revealed={revealed}
                    onRevealedChange={setRevealed} onChange={(e) => setPw(e.target.value)} />
                <ClaimStrengthMeter level={level} />
            </Field>
            <Field label="Confirm password" error={mismatch ? PASSWORD_MISMATCH_MESSAGE : undefined}>
                <PasswordInput label="confirm password" autoComplete="new-password" value={confirm} revealed={revealed}
                    success={confirm.length > 0 && confirm === pw && isPasswordValid(pw)}
                    onRevealedChange={setRevealed} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <Checkbox label="Show passwords" checked={revealed} onChange={(e) => setRevealed(e.target.checked)} />
        </>
    );
}

/** Continue after the claim: setup when signed in, else the sign-in page. */
function ContinueLink({ signedIn }: { signedIn: boolean }): JSX.Element {
    const queryClient = useQueryClient();
    const onClick = (): void => {
        // Same event as the navigation, so ClaimGate never bounces /claim → /.
        queryClient.setQueryData(['system', 'status'], (old: object | undefined) => ({ ...old, claimRequired: false, claimExpiresAt: undefined }));
        void queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
    };
    return (
        <Link to={signedIn ? '/admin/setup' : '/login'} onClick={onClick} className={buttonClass({ variant: 'primary', fullWidth: true })}>
            {signedIn ? 'Continue to setup' : 'Sign in to continue'}
        </Link>
    );
}

/** The whole claim form; `expiredOnLoad` starts in the expired state. */
export function ClaimForm({ expiredOnLoad = false }: { expiredOnLoad?: boolean }): JSX.Element {
    const msgId = useId();
    const { code, setCode, pw, setPw, confirm, setConfirm, status, pwRefused, pending, signedIn, codeRef, pwRef, onSubmit } = useClaimSubmit(expiredOnLoad);
    const invalid = !['idle', 'ok', 'locked'].includes(status.kind);
    const done = status.kind === 'ok';
    return (
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" data-testid="claim-form">
            <Field label="Setup code">
                <Input ref={codeRef} mono autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX" value={code} readOnly={done}
                    className="tracking-wider" invalid={invalid && !pending} success={done} aria-describedby={msgId}
                    onChange={(e) => setCode(e.target.value)} data-testid="claim-code" />
                <CodeMessage id={msgId} status={status} checking={pending} />
            </Field>
            <Field label="Sign-in name" hint="Fixed. Once Discord is connected you can sign in with Discord instead.">
                <Input mono readOnly value="admin@local" className="text-muted" />
            </Field>
            <PasswordFields pw={pw} confirm={confirm} setPw={setPw} setConfirm={setConfirm} refused={pwRefused} pwRef={pwRef} />
            {done ? <ContinueLink signedIn={signedIn} /> : (
                <Button type="submit" fullWidth loading={pending} loadingLabel="Checking the code…" data-testid="claim-submit">
                    Claim and set password
                </Button>
            )}
        </form>
    );
}
