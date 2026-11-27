/**
 * ROK-2371: Profile → Integrations → Google sign-in. Three states: "Link
 * Google" (while the admin allows Google sign-in), "Linked as <email>" with
 * Unlink, and nothing at all when Google sign-in is off and nothing is linked.
 * Link mirrors Discord: POST /auth/google/link/start, then navigate to the
 * single-use nonce hop; the callback lands back here with `?linked=`.
 */
import type { JSX } from 'react';
import type { SigninMethodsDto } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { useGoogleLinkAction } from './identity-hooks';
import { SigninUnlinkButton } from './signin-unlink-button';

/** Google's "G" mark — brand artwork, the only fixed colours on this panel. */
export function GoogleMark({ className = 'w-5 h-5' }: { className?: string }): JSX.Element {
    return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81z" />
            <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24z" />
            <path fill="#FBBC05" d="M5.29 14.29a7.2 7.2 0 0 1 0-4.58V6.6H1.28a12 12 0 0 0 0 10.8l4.01-3.11z" />
            <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.28 6.6l4.01 3.11C6.23 6.88 8.88 4.77 12 4.77z" />
        </svg>
    );
}

function GoogleLinkedRow({ methods }: { methods: SigninMethodsDto }): JSX.Element {
    const email = methods.google?.email;
    return (
        <div className="flex flex-wrap items-center gap-4 p-4 rounded-lg bg-success/5 border border-success/20"
            data-testid="google-linked">
            <GoogleMark className="w-8 h-8 shrink-0" />
            <div className="flex-1 min-w-0 basis-48">
                <p className="text-sm font-medium text-foreground truncate">
                    {email ? `Linked as ${email}` : 'Google linked'}
                </p>
                <p className="text-xs text-success">You can sign in with Google</p>
            </div>
            <SigninUnlinkButton method="google" methods={methods} />
        </div>
    );
}

function GoogleLinkRow(): JSX.Element {
    const { linkGoogle, isPending } = useGoogleLinkAction();
    return (
        <div className="flex flex-wrap items-center gap-4 p-4 rounded-lg bg-panel border border-edge-subtle"
            data-testid="google-unlinked">
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Google</p>
                <p className="text-xs text-muted">Link a Google account to sign in with it too.</p>
            </div>
            <Button variant="secondary" onClick={linkGoogle} loading={isPending} loadingLabel="Opening Google…"
                className="inline-flex items-center gap-2" data-testid="link-google">
                <GoogleMark />
                Link Google
            </Button>
        </div>
    );
}

/** `googleAvailable`: the admin allows Google sign-in (`/system/status` lists it). */
export function GoogleSigninPanel({ methods, googleAvailable }: {
    methods: SigninMethodsDto | undefined; googleAvailable: boolean;
}): JSX.Element | null {
    if (methods?.google) return <GoogleLinkedRow methods={methods} />;
    if (!googleAvailable || !methods) return null;
    return <GoogleLinkRow />;
}
