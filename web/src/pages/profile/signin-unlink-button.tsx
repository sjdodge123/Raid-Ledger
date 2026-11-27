/**
 * ROK-2371: the Unlink control for a sign-in method (Discord or Google) on
 * Profile → Integrations. Disabled with the server's copy while it is the
 * user's last way to sign in; a refusal that comes back anyway shows inline.
 */
import type { JSX } from 'react';
import type { SigninMethodsDto } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { useUnlinkSigninMethod } from './identity-hooks';
import { LAST_SIGNIN_METHOD_COPY, isLastSigninMethod, type UnlinkableMethod } from './signin-methods.helpers';

const LABEL: Record<UnlinkableMethod, string> = { discord: 'Discord', google: 'Google' };

export function SigninUnlinkButton({ method, methods }: {
    method: UnlinkableMethod; methods: SigninMethodsDto | undefined;
}): JSX.Element {
    const { unlink, isPending, error } = useUnlinkSigninMethod(method);
    const isLast = isLastSigninMethod(methods, method);
    const hintId = `unlink-${method}-hint`;
    const message = isLast ? LAST_SIGNIN_METHOD_COPY : error;
    return (
        <div className="flex flex-col items-end gap-1">
            <Button variant="secondary" size="sm" onClick={unlink} disabled={isLast} loading={isPending}
                aria-describedby={message ? hintId : undefined} data-testid={`unlink-${method}`}>
                Unlink {LABEL[method]}
            </Button>
            {message && (
                <p id={hintId} role={isLast ? undefined : 'alert'} className="text-xs text-muted text-right"
                    data-testid={`unlink-${method}-hint`}>
                    {message}
                </p>
            )}
        </div>
    );
}
