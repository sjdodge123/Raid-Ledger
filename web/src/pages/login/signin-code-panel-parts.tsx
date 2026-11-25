/**
 * ROK-2370: presentational pieces of the Discord-app sign-in code panel.
 * Tokens only — the code tile is `bg-panel border-edge`, the instruction is
 * the §4.7 neutral callout. Never names a browser or an OS.
 */
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { CopyButton } from '../../components/ui/CopyButton';

export const EXPIRED_COPY = 'This code expired.';
export const START_FAILED_COPY = 'Couldn’t get a code just now. Check your connection and try again.';
export const SIGNIN_FAILED_COPY = 'Couldn’t sign you in just now. Get a new code and try again.';

/** `m:ss` for a non-negative millisecond count. */
export function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Milliseconds left until `expiresAt`, re-rendered every second. */
function useRemainingMs(expiresAt: string): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, []);
    return Date.parse(expiresAt) - now;
}

/** The code tile, Copy code, the Discord instruction and the waiting line. */
export function SigninCodeWaiting({ code, expiresAt, onCancel }: {
    code: string; expiresAt: string; onCancel: () => void;
}): JSX.Element {
    const remaining = useRemainingMs(expiresAt);
    return (
        <div className="space-y-3" data-testid="signin-code-waiting">
            <div className="flex items-center justify-between gap-2 p-3 bg-panel border border-edge rounded-lg">
                <span className="font-mono text-2xl font-semibold tracking-widest text-foreground" data-testid="signin-code-value">
                    {code}
                </span>
                <CopyButton text={code} label="Copy code" />
            </div>
            <p className="p-3 bg-overlay/30 border border-edge rounded-lg text-sm text-secondary">
                In Discord, type <strong className="font-semibold text-foreground">/login code:{code}</strong> and tap{' '}
                <strong className="font-semibold text-foreground">Yes, sign me in</strong>. Then come back to this browser.
            </p>
            <div className="flex items-center justify-between gap-2">
                <p role="status" className="text-xs text-muted">
                    Waiting for Discord… code expires in {formatCountdown(remaining)}.
                </p>
                <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
            </div>
        </div>
    );
}

/** A one-line message plus one action (expired, failed start, idle). */
export function SigninCodeMessage({ message, action, onAction, alert = false }: {
    message: string | null; action: string; onAction: () => void; alert?: boolean;
}): JSX.Element {
    return (
        <div className="space-y-3 text-center">
            {message && <p role={alert ? 'alert' : 'status'} className="text-sm text-secondary">{message}</p>}
            <Button variant="secondary" size="sm" onClick={onAction}>{action}</Button>
        </div>
    );
}

/** Success: names the account, so a member signed into the wrong one can back out. */
export function SigninCodeSignedIn({ name, onSignOut }: { name: string; onSignOut: () => void }): JSX.Element {
    return (
        <div className="space-y-1 text-center" data-testid="signin-code-signed-in">
            <p role="status" className="text-sm font-semibold text-success">
                <span aria-hidden="true">✓ </span>Signed in as {name}.
            </p>
            <p className="text-xs text-muted">Taking you to the calendar…</p>
            <Button variant="ghost" size="sm" onClick={onSignOut}>Not you? Sign out</Button>
        </div>
    );
}
