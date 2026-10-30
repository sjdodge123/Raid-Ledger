/**
 * The claim form (ROK-1701, approved claim sheet C4/C5): setup code, fixed
 * sign-in name, new + confirm password with one "Show passwords" control,
 * and the submit → server result states. Inventory primitives only.
 */
import { useId, useState, type FormEvent, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { SETUP_CLAIM_PASSWORD_MIN } from '@raid-ledger/contract';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { PasswordInput } from '../../components/ui/password-input';
import { Checkbox } from '../../components/ui/checkbox';
import { Button } from '../../components/ui/button';
import { buttonClass } from '../../components/ui/button-classes';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useClaim } from './use-claim';
import { ClaimStrengthMeter } from './claim-strength-meter';
import {
    PASSWORD_GUARD_MESSAGE, PASSWORD_MISMATCH_MESSAGE, TONE_TEXT, codeMessage,
    passwordStrength, strengthHint, type CodeStatus,
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

function PasswordFields({ pw, confirm, setPw, setConfirm }: {
    pw: string; confirm: string; setPw: (v: string) => void; setConfirm: (v: string) => void;
}): JSX.Element {
    const [revealed, setRevealed] = useState(false);
    const level = passwordStrength(pw);
    const hint = strengthHint(level);
    const mismatch = confirm.length > 0 && confirm !== pw;
    return (
        <>
            <Field label="New password" hint={<span className={TONE_TEXT[hint.tone]}>{hint.text}</span>}>
                <PasswordInput label="new password" autoComplete="new-password" value={pw} revealed={revealed}
                    onRevealedChange={setRevealed} onChange={(e) => setPw(e.target.value)} />
                <ClaimStrengthMeter level={level} />
            </Field>
            <Field label="Confirm password" error={mismatch ? PASSWORD_MISMATCH_MESSAGE : undefined}>
                <PasswordInput label="confirm password" autoComplete="new-password" value={confirm} revealed={revealed}
                    onRevealedChange={setRevealed} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <Checkbox label="Show passwords" checked={revealed} onChange={(e) => setRevealed(e.target.checked)} />
        </>
    );
}

function ContinueLink(): JSX.Element {
    const queryClient = useQueryClient();
    const onClick = (): void => {
        // Same event as the navigation, so ClaimGate never bounces /claim → /.
        queryClient.setQueryData(['system', 'status'], (old: object | undefined) => ({ ...old, claimRequired: false, claimExpiresAt: undefined }));
        void queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
    };
    return <Link to="/admin/setup" onClick={onClick} className={buttonClass({ variant: 'primary', fullWidth: true })}>Continue to setup</Link>;
}

/** The whole claim form; `expiredOnLoad` starts in the expired state. */
export function ClaimForm({ expiredOnLoad = false }: { expiredOnLoad?: boolean }): JSX.Element {
    const msgId = useId();
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
    const invalid = status.kind !== 'idle' && status.kind !== 'ok';
    const done = status.kind === 'ok';
    return (
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-[18px]" data-testid="claim-form">
            <Field label="Setup code">
                <Input mono autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX" value={code} readOnly={done}
                    className="tracking-wider" invalid={invalid && !claim.isPending} aria-describedby={msgId}
                    onChange={(e) => setCode(e.target.value)} data-testid="claim-code" />
                <CodeMessage id={msgId} status={status} checking={claim.isPending} />
            </Field>
            <Field label="Sign-in name" hint="Fixed. Once Discord is connected you can sign in with Discord instead.">
                <Input mono readOnly value="admin@local" className="text-muted" />
            </Field>
            <PasswordFields pw={pw} confirm={confirm} setPw={setPw} setConfirm={setConfirm} />
            {pwRefused && <p role="alert" className="text-sm text-danger">{PASSWORD_GUARD_MESSAGE}</p>}
            {done ? <ContinueLink /> : (
                <Button type="submit" fullWidth loading={claim.isPending} loadingLabel="Checking the code…" data-testid="claim-submit">
                    Claim and set password
                </Button>
            )}
        </form>
    );
}
