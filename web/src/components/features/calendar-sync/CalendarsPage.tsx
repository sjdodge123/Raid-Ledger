/**
 * Profile → Calendars (ROK-1594): connect Google (K1), the connected card(s)
 * with Manage → Disconnect (K2), and the K4 desktop shell — the same cards in
 * a two-column grid from 1024px. Nothing renders but a notice when the admin
 * kill switch is off; the nav entries hide on the same flag.
 */
import type { JSX, ReactNode } from 'react';
import { Button } from '../../ui/button';
import { useCalendarsOverview } from '../../../hooks/use-calendar-sync';
import { CalendarProviderRow } from './CalendarProviderRow';
import { CalendarConnectionCard } from './CalendarConnectionCard';
import { useCalendarOAuthFeedback } from './use-calendar-oauth-feedback';
import { CALENDARS_COPY as C, oauthErrorMessage } from './calendar-sync.copy';

function Section({ heading, children }: { heading: string; children: ReactNode }): JSX.Element {
    return (
        <section className="bg-surface border border-edge-subtle rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{heading}</h3>
            {children}
        </section>
    );
}

/** §4.7 status banner for `?error=<code>`; dismissible. */
function OAuthErrorBanner({ code, onDismiss }: { code: string; onDismiss: () => void }): JSX.Element {
    return (
        <div role="alert" data-testid="calendar-oauth-error" data-error-code={code}
            className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 p-3">
            {/* Body is text-foreground, not §4.7's text-danger, for contrast on the tint; border + tint carry the tone. */}
            <p className="flex-1 text-sm text-foreground">{oauthErrorMessage(code)}</p>
            <Button variant="ghost" size="sm" onClick={onDismiss}>{C.dismiss}</Button>
        </div>
    );
}

function PageFrame({ lede, children }: { lede?: string; children: ReactNode }): JSX.Element {
    return (
        <div className="space-y-6 pb-8" data-testid="calendars-page">
            <header className="space-y-1">
                <h2 className="text-xl font-semibold text-foreground">{C.title}</h2>
                {lede && <p className="text-sm text-muted">{lede}</p>}
            </header>
            {children}
        </div>
    );
}

function PrivacyNote(): JSX.Element {
    return (
        <p className="rounded-lg border border-edge bg-overlay/30 p-4 text-sm text-secondary">
            <b className="text-foreground">{C.noteTitle}</b> {C.noteBody}
        </p>
    );
}

export function CalendarsPage(): JSX.Element {
    const { data, isLoading, isError } = useCalendarsOverview();
    const { errorCode, dismissError } = useCalendarOAuthFeedback();
    if (isLoading) return <PageFrame>{null}</PageFrame>;
    if (isError || !data) return <PageFrame><p className="text-sm text-muted">{C.loadError}</p></PageFrame>;
    if (!data.enabled) {
        return <PageFrame><p className="text-sm text-muted" data-testid="calendars-unavailable">{C.unavailable}</p></PageFrame>;
    }
    const google = data.connections.filter((c) => c.provider === 'google');
    return (
        <PageFrame lede={C.lede}>
            {errorCode && <OAuthErrorBanner code={errorCode} onDismiss={dismissError} />}
            <div className="grid gap-4 lg:grid-cols-2">
                {google.length > 0 && (
                    <Section heading={C.connectedHeading}>
                        {google.map((c) => <CalendarConnectionCard key={c.id} connection={c} />)}
                    </Section>
                )}
                {/* Q15: several Google accounts are allowed, so the row stays once one is connected. */}
                <Section heading={C.addHeading}>
                    <CalendarProviderRow available={data.providers.google.available} another={google.length > 0} />
                </Section>
            </div>
            <PrivacyNote />
        </PageFrame>
    );
}
