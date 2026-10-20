/**
 * Calendars (ROK-1594), a section of Profile → My Integrations since ROK-1780: connect Google (K1), the connected card(s)
 * with Manage → Disconnect (K2), and the K4 desktop shell — the same cards in
 * a two-column grid from 1024px, plus the read rules (ROK-1595: K2 switches
 * on phone, K4 radio cards on desktop). Nothing renders but a notice when the admin
 * kill switch is off; My Integrations hides the whole section on the same flag.
 * ROK-1598: provider-generic — Google and Apple iCloud connections share the
 * Connected list, read rules and Send events; Microsoft stays hidden.
 */
import type { JSX, ReactNode } from 'react';
import type { CalendarConnection, CalendarReadMode, CalendarsOverview } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { useCalendarsOverview } from '../../../hooks/use-calendar-sync';
import { CalendarProviderRow } from './CalendarProviderRow';
import { AppleProviderRow } from './AppleProviderRow';
import { countOf, shippedConnections } from './calendar-providers';
import { CalendarConnectionCard } from './CalendarConnectionCard';
import { CalendarReadRules } from './CalendarReadRules';
import { readableConnections } from './use-read-rules';
import { SendEventsSettings } from './SendEventsSettings';
import { SendEventsEntryRow } from './SendEventsEntryRow';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { useCalendarOAuthFeedback } from './use-calendar-oauth-feedback';
import { SubscribeLinkCard } from './SubscribeLinkCard';
import { FEED_COPY as F } from './calendar-feed.copy';
import { CALENDARS_COPY as C, READ_COPY as R, SEND_EVENTS_COPY as S, oauthErrorMessage } from './calendar-sync.copy';

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
        <div id="calendars" className="space-y-6 pb-8" data-testid="calendars-page">
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

/**
 * ROK-1595 read rules: K2 switches inside the phone column, K4 radio cards as a
 * full-width row on desktop. The mode is per USER (D1) and the mirror draws one
 * section (K2) / one card (K4), so it renders ONCE for the page, over every
 * live connection — never bound to the first one. Read on/off (2+ readable
 * accounts) and the calendar picker are per connection, on each card.
 */
function ReadRules({ connections, mode, desktopRow }: { connections: CalendarConnection[]; mode: CalendarReadMode; desktopRow: boolean }): JSX.Element | null {
    const desktop = useMediaQuery(DESKTOP_MQ);
    const live = liveConnections(connections);
    if (desktop !== desktopRow || live.length === 0) return null;
    return <CalendarReadRules connections={live} mode={mode} desktop={desktop} />;
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

/**
 * ROK-1599 K6: the subscribe link — one full-width section after Send events
 * and "Add a calendar" at every width (operator 2026-10-16: same order on
 * phone and desktop).
 */
function SubscribeLink({ feed }: { feed: CalendarsOverview['feed'] }): JSX.Element {
    return <Section heading={F.heading}><SubscribeLinkCard feed={feed} /></Section>;
}

/** Q15: several accounts per provider are allowed, so each row stays once one is connected. */
function AddCalendar({ data, shown }: { data: CalendarsOverview; shown: CalendarConnection[] }): JSX.Element {
    return (
        <Section heading={C.addHeading}>
            <CalendarProviderRow available={data.providers.google.available} another={countOf(shown, 'google') > 0} />
            <AppleProviderRow available={data.providers.apple.available} another={countOf(shown, 'apple') > 0} />
        </Section>
    );
}

/** The K2 column / K4 two-card grid: Connected, (phone) Read + Write, Add a calendar. */
function ConnectionsGrid({ data }: { data: CalendarsOverview }): JSX.Element {
    const shown = shippedConnections(data.connections);
    const readable = readableConnections(shown);
    const readSwitch = readable.length > 1;
    // R2: every card's "Read this account" is off — say so quietly, no warning tone.
    const readingNone = readSwitch && readable.every((c) => !c.read.enabled);
    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {shown.length > 0 && (
                <Section heading={C.connectedHeading}>
                    {shown.map((c) => (
                        <CalendarConnectionCard key={c.id} connection={c} readSwitch={readSwitch}
                            anyReadable={readable.length > 0} showAccount={countOf(shown, c.provider) > 1} />
                    ))}
                    {readingNone && <p className="text-xs text-muted" data-testid="calendar-reading-none">{R.notReadingAny}</p>}
                </Section>
            )}
            <ReadRules connections={shown} mode={data.readSettings.mode} desktopRow={false} />
            <PhoneWriteSection connections={shown} />
            <AddCalendar data={data} shown={shown} />
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
    const shown = shippedConnections(data.connections);
    return (
        <PageFrame lede={desktop ? C.ledeDesktop : C.lede}>
            {errorCode && <OAuthErrorBanner code={errorCode} onDismiss={dismissError} />}
            <ConnectionsGrid data={data} />
            <ReadRules connections={shown} mode={data.readSettings.mode} desktopRow />
            <DesktopSendEvents connections={shown} />
            <SubscribeLink feed={data.feed} />
            <PrivacyNote />
        </PageFrame>
    );
}
