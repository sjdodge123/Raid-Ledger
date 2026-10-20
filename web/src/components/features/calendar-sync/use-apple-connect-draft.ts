/**
 * The Apple connect form's draft (ROK-1598 K3): email + app-specific password,
 * validated with the contract's `AppleConnectInputSchema` (the server's own
 * rule). The password lives ONLY in this component state — never storage, the
 * URL or a log — and is wiped whenever the sheet opens or closes.
 */
import { useState } from 'react';
import { AppleConnectInputSchema, type AppleConnectInput } from '@raid-ledger/contract';
import { APPLE_CONNECT_COPY as A } from './apple-connect.copy';

type DraftField = 'email' | 'appPassword';

export interface AppleConnectDraft {
    email: string;
    password: string;
    setEmail: (v: string) => void;
    setPassword: (v: string) => void;
    /** Mark a field blurred, so its format error may show. */
    touch: (field: DraftField) => void;
    /** The parsed body when both fields are valid, else null (Connect stays disabled). */
    input: AppleConnectInput | null;
    emailError: string | undefined;
    passwordError: string | undefined;
    /** Typed anything beyond the prefill — the close asks first. */
    dirty: boolean;
    clearPassword: () => void;
}

function parseDraft(email: string, password: string) {
    const parsed = AppleConnectInputSchema.safeParse({ email: email.trim(), appPassword: password.trim() });
    if (parsed.success) return { input: parsed.data, bad: new Set<string>() };
    return { input: null, bad: new Set(parsed.error.issues.map((i) => String(i.path[0]))) };
}

/** See file docstring. `initialEmail` is the reconnect prefill (`connection.accountLabel`). */
export function useAppleConnectDraft(isOpen: boolean, initialEmail: string): AppleConnectDraft {
    const [email, setEmail] = useState(initialEmail);
    const [password, setPassword] = useState('');
    const [touched, setTouched] = useState<ReadonlySet<DraftField>>(new Set());
    const [wasOpen, setWasOpen] = useState(isOpen);
    if (wasOpen !== isOpen) {
        // Reset during render on every open/close edge (React's "adjust state on a prop change").
        setWasOpen(isOpen);
        setEmail(initialEmail);
        setPassword('');
        setTouched(new Set());
    }
    const { input, bad } = parseDraft(email, password);
    const show = (f: DraftField, value: string) => touched.has(f) && value.trim() !== '' && bad.has(f);
    return {
        email, password, setEmail, setPassword, input,
        touch: (f) => setTouched((prev) => new Set(prev).add(f)),
        emailError: show('email', email) ? A.emailInvalid : undefined,
        passwordError: show('appPassword', password) ? A.passwordInvalid : undefined,
        dirty: password !== '' || email.trim() !== initialEmail.trim(),
        clearPassword: () => setPassword(''),
    };
}
