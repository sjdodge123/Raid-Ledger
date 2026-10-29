/**
 * §4.7 status banner for a calendar OAuth `?error=<code>` return; dismissible.
 * Shared by Profile → Integrations (`CalendarsPage`) and the first-run
 * wizard's Calendar step (ROK-2022) — moved out of `CalendarsPage`, not copied.
 */
import type { JSX } from 'react';
import { Button } from '../../ui/button';
import { CALENDARS_COPY as C, oauthErrorMessage } from './calendar-sync.copy';

export function CalendarOAuthErrorBanner({ code, onDismiss }: { code: string; onDismiss: () => void }): JSX.Element {
    return (
        <div role="alert" data-testid="calendar-oauth-error" data-error-code={code}
            className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 p-3">
            {/* Body is text-foreground, not §4.7's text-danger, for contrast on the tint; border + tint carry the tone. */}
            <p className="flex-1 text-sm text-foreground">{oauthErrorMessage(code)}</p>
            <Button variant="ghost" size="sm" onClick={onDismiss}>{C.dismiss}</Button>
        </div>
    );
}
