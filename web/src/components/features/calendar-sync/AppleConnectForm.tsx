/**
 * K3 body (ROK-1598): why an app-specific password, the three steps, Apple's
 * help article, the two fields and the privacy line. A refused connect shows
 * inline (`role="alert"`), never as a toast (§4.8). The footer's Connect
 * submits this form by `form={formId}`, so Enter in either field submits too.
 */
import type { FormEvent, JSX } from 'react';
import type { AppleConnectInput } from '@raid-ledger/contract';
import type { AppleConnectFailure } from '../../../hooks/use-calendar-sync';
import { Field } from '../../ui/field';
import { Input } from '../../ui/input';
import { PasswordInput } from '../../ui/password-input';
import { APPLE_APP_PASSWORD_HELP_URL, APPLE_CONNECT_COPY as A, APPLE_CONNECT_ERROR_COPY } from './apple-connect.copy';
import type { AppleConnectDraft } from './use-apple-connect-draft';

export interface AppleConnectFormProps {
    formId: string;
    draft: AppleConnectDraft;
    failure: AppleConnectFailure | null;
    onSubmit: (input: AppleConnectInput) => void;
}

function Steps(): JSX.Element {
    return (
        <div className="space-y-2 text-sm text-secondary">
            <p>{A.intro}</p>
            <ol className="list-decimal space-y-1 pl-5">
                {A.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <p className="text-xs text-muted">{A.twoFactor}</p>
            <a href={APPLE_APP_PASSWORD_HELP_URL} target="_blank" rel="noopener noreferrer"
                className="inline-block text-sm text-foreground underline hover:text-secondary"
                data-testid="apple-connect-help-link">
                {A.helpLink}
            </a>
        </div>
    );
}

function Fields({ draft }: { draft: AppleConnectDraft }): JSX.Element {
    return (
        <div className="space-y-3">
            <Field label={A.emailLabel} error={draft.emailError} required>
                <Input type="email" autoComplete="username" inputMode="email" value={draft.email}
                    onChange={(e) => draft.setEmail(e.target.value)} onBlur={() => draft.touch('email')}
                    data-testid="apple-connect-email" />
            </Field>
            <Field label={A.passwordLabel} error={draft.passwordError} required>
                <PasswordInput label={A.passwordLabel} autoComplete="off" data-1p-ignore data-lpignore="true"
                    placeholder={A.passwordPlaceholder} value={draft.password} mono spellCheck={false}
                    onChange={(e) => draft.setPassword(e.target.value)} onBlur={() => draft.touch('appPassword')}
                    data-testid="apple-connect-password" />
            </Field>
        </div>
    );
}

export function AppleConnectForm({ formId, draft, failure, onSubmit }: AppleConnectFormProps): JSX.Element {
    const submit = (e: FormEvent<HTMLFormElement>): void => {
        e.preventDefault();
        if (draft.input) onSubmit(draft.input);
    };
    return (
        <form id={formId} onSubmit={submit} noValidate className="space-y-4" data-testid="apple-connect-form">
            <Steps />
            <Fields draft={draft} />
            {failure && (
                <p role="alert" className="text-sm text-danger" data-testid="apple-connect-error" data-failure={failure}>
                    {APPLE_CONNECT_ERROR_COPY[failure]}
                </p>
            )}
            <p className="text-xs text-muted">{A.privacy}</p>
        </form>
    );
}
