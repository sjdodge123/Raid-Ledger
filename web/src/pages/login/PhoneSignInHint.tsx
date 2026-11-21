import type { JSX } from 'react';
import { useMediaQuery } from '../../hooks/use-media-query';
import { PHONE_MQ } from '../../lib/breakpoints';

/**
 * ROK-2291 (ROK-2282 follow-up): phones lose the sign-in when browser storage
 * is cleared, not because the session expires. Below 1024px the login card
 * says so and points at the `/login` Discord command (ROK-2283).
 *
 * §4.7 neutral instruction callout, same panel as the first-run banner. The
 * caller decides whether Discord sign-in is offered; this only checks width.
 */
export function PhoneSignInHint(): JSX.Element | null {
    const isPhone = useMediaQuery(PHONE_MQ);
    if (!isPhone) return null;
    return (
        <div role="note" data-testid="phone-signin-hint"
            className="mt-4 p-3 bg-overlay/30 border border-edge rounded-lg text-sm text-secondary">
            <strong className="font-medium text-foreground">On a phone?</strong>{' '}
            Sign in once and this browser keeps you signed in. No Discord password handy? Type{' '}
            <code className="px-1 rounded border border-edge bg-panel text-foreground">/login</code>{' '}
            in our Discord server for a sign-in link.
        </div>
    );
}
