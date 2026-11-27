/**
 * ROK-2371: "Allow sign-in with Google" inside the Google block of Admin →
 * Calendar Sync. It reuses that block's client id + secret, so the toggle,
 * the two sign-in redirect URIs (copy-only) and the set-up checklist sit
 * beside them. Enabling with no client is refused by the server with 400
 * "Set the Google client first", shown inline here.
 */
import type { JSX } from 'react';
import { Switch } from '../ui/switch';
import { CopyableInput } from './admin-form-helpers';

const URI_LABELS = ['Google sign-in redirect URI', 'Google link redirect URI'] as const;

function SigninRedirectUris({ uris }: { uris: readonly string[] }): JSX.Element | null {
    if (uris.length === 0) return null;
    return (
        <div className="space-y-3" data-testid="google-signin-redirect-uris">
            {uris.map((uri, i) => {
                const label = URI_LABELS[i] ?? `Google sign-in redirect URI ${i + 1}`;
                return (
                    <div key={uri}>
                        <p className="text-sm font-medium text-foreground mb-1">{label}</p>
                        <CopyableInput value={uri} onCopied="Redirect URI copied" label={label} />
                    </div>
                );
            })}
            <p className="text-xs text-dim">Click to copy. Add both to the same Google client.</p>
        </div>
    );
}

function SigninChecklist(): JSX.Element {
    return (
        <div className="bg-overlay/30 border border-edge rounded-lg p-4" data-testid="google-signin-checklist">
            <p className="text-sm font-medium text-foreground mb-2">Before you turn it on</p>
            <ol className="list-decimal pl-5 space-y-1 text-sm text-secondary">
                <li>Client ID + secret saved above.</li>
                <li>Both sign-in redirect URIs added to the OAuth client in Google Cloud.</li>
                <li>OAuth consent screen is <strong className="text-foreground">In production</strong> (in
                    &ldquo;Testing&rdquo; only listed test users can sign in).</li>
                <li>Turn on the toggle.</li>
            </ol>
        </div>
    );
}

export function GoogleSigninBlock({ checked, saved, onChange, redirectUris, error }: {
    checked: boolean; saved: boolean; onChange: (next: boolean) => void;
    redirectUris: readonly string[]; error: string | null;
}): JSX.Element {
    return (
        <div className="space-y-4 border-t border-edge pt-4" data-testid="google-signin-block">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-sm font-medium text-foreground">Allow sign-in with Google</p>
                    <p id="google-signin-enabled-hint" className="text-xs text-muted mt-1">
                        Off by default. Members can then sign in with Google and link it from their Profile.
                    </p>
                    {checked !== saved && (
                        <p className="text-xs text-warning mt-1">Not saved yet — press Save Configuration to apply.</p>
                    )}
                    {error && <p role="alert" className="mt-1 text-sm text-danger" data-testid="google-signin-error">{error}</p>}
                </div>
                <Switch checked={checked} onChange={onChange} label="Allow sign-in with Google"
                    aria-describedby="google-signin-enabled-hint" testId="google-signin-enabled" />
            </div>
            <SigninChecklist />
            <SigninRedirectUris uris={redirectUris} />
        </div>
    );
}
