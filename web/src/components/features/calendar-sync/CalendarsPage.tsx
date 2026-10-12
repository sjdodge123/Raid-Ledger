/**
 * Profile → Calendars (ROK-1594): connect Google (K1), the connected card(s)
 * with Manage → Disconnect (K2), and the K4 desktop shell — the same cards in
 * a two-column grid from 1024px, plus the read rules (ROK-1595: K2 switches
 * on phone, K4 radio cards on desktop). Nothing renders but a notice when the admin
 * kill switch is off; the nav entries hide on the same flag.
 */
import type { JSX, ReactNode } from 'react';
import type { CalendarConnection, CalendarReadMode, CalendarsOverview } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { useCalendarsOverview } from '../../../hooks/use-calendar-sync';
import { CalendarProviderRow } from './CalendarProviderRow';
import { CalendarConnectionCard } from './CalendarConnectionCard';
import { CalendarReadRules } from './CalendarReadRules';
import { SendEventsSettings } from './SendEventsSettings';
import { SendEventsEntryRow } from './SendEventsEntryRow';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { useCalendarOAuthFeedback } from './use-calendar-oauth-feedback';
import { CALENDARS_COPY as C, SEND_EVENTS_COPY as S, oauthErrorMessage } from './calendar-sync.copy';

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

function liveConnections(connections: CalendarConnection[]): CalendarConnection[] {
    return connections.filter((c) => c.status !== 'disconnecting');
}

/** ROK-1596 K4: desktop carries the send settings as inline cards after the grid. */
function DesktopSendEvents({ connections }: { connections: CalendarConnection[] }): JSX.Element | null {
    const desktop = useMediaQuery(DESKTOP_MQ);
    if (!desktop) return null;
    return <>{liveConnections(connections).map((c) => <SendEventsSettings key={c.id} connection={c} />)}</>;
}

/** ROK-1595 read rules: K2 switches inside the phone column, K4 radio cards as a full-width row on desktop. */
function ReadRules({ connections, mode, desktopRow }: { connections: CalendarConnection[]; mode: CalendarReadMode; desktopRow: boolean }): JSX.Element {
    const desktop = useMediaQuery(DESKTOP_MQ);
    if (desktop !== desktopRow) return <></>;
    return <>{liveConnections(connections).map((c) => <CalendarReadRules key={c.id} connection={c} mode={mode} desktop={desktop} />)}</>;
}

/** ROK-1596 K2 (phone): "Write · send my Raid Ledger events" under the connection, before "Add a calendar"; each row opens K5 (W1b). */
function PhoneWriteSection({ connections }: { connections: CalendarConnection[] }): JSX.Element | null {
    const desktop = useMediaQuery(DESKTOP_MQ);
    const live = liveConnections(connections);
    if (desktop || live.length === 0) return null;
    return (
        <Section heading={S.writeHeading}>
            {live.map((c) => <SendEventsEntryRow key={c.id} connection={c} />)}
        </Section>
    );
}

/** The K2 column / K4 two-card grid: Connected, (phone) Read + Write, Add a calendar. */
function ConnectionsGrid({ data }: { data: CalendarsOverview }): JSX.Element {
    const google = data.connections.filter((c) => c.provider === 'google');
    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {google.length > 0 && (
                <Section heading={C.connectedHeading}>
                    {google.map((c) => <CalendarConnectionCard key={c.id} connection={c} />)}
                </Section>
            )}
            <ReadRules connections={google} mode={data.readSettings.mode} desktopRow={false} />
            <PhoneWriteSection connections={google} />
            {/* Q15: several Google accounts are allowed, so the row stays once one is connected. */}
            <Section heading={C.addHeading}>
                <CalendarProviderRow available={data.providers.google.available} another={google.length > 0} />
            </Section>
        </div>
    );
}

export function CalendarsPage(): JSX.Element {
    const { data, isLoading, isError } = useCalendarsOverview();
    const { errorCode, dismissError } = useCalendarOAuthFeedback();
    const desktop = useMediaQuery(DESKTOP_MQ);
    if (isLoading) return <PageFrame>{null}</PageFrame>;
    if (isError || !data) return <PageFrame><p className="text-sm text-muted">{C.loadError}</p></PageFrame>;
    if (!data.enabled) {
        return <PageFrame><p className="text-sm text-muted" data-testid="calendars-unavailable">{C.unavailable}</p></PageFrame>;
    }
    const google = data.connections.filter((c) => c.provider === 'google');
    return (
        <PageFrame lede={desktop ? C.ledeDesktop : C.lede}>
            {errorCode && <OAuthErrorBanner code={errorCode} onDismiss={dismissError} />}
            <ConnectionsGrid data={data} />
            <ReadRules connections={google} mode={data.readSettings.mode} desktopRow />
            <DesktopSendEvents connections={google} />
            <PrivacyNote />
        </PageFrame>
    );
}
