/**
 * ROK-2022: the first-run wizard's Calendar step (after Game Time). Connect
 * only (operator ruling Q3): the provider rows from Profile → Integrations, or —
 * once connected — the connected card(s). Read rules, the picker and
 * send-events stay on Profile → Integrations, which the footer note points to.
 *
 * Google leaves the app; its callback lands on
 * `/onboarding?resume=calendar&connected=google|error=<code>` and the wizard
 * re-opens on this step, so the toast / error banner come from the same
 * `useCalendarOAuthFeedback` the Integrations page uses. Apple connects in-page.
 */
import type { JSX } from 'react';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import type { CalendarConnection, CalendarsOverview } from '@raid-ledger/contract';
import { useCalendarsOverview } from '../../hooks/use-calendar-sync';
import { CalendarProviderRow } from '../features/calendar-sync/CalendarProviderRow';
import { AppleProviderRow } from '../features/calendar-sync/AppleProviderRow';
import { CalendarConnectionCard } from '../features/calendar-sync/CalendarConnectionCard';
import { CalendarOAuthErrorBanner } from '../features/calendar-sync/CalendarOAuthErrorBanner';
import { countOf, shippedConnections } from '../features/calendar-sync/calendar-providers';
import { readableConnections } from '../features/calendar-sync/use-read-rules';
import { useCalendarOAuthFeedback } from '../features/calendar-sync/use-calendar-oauth-feedback';
import { CALENDARS_COPY as C } from '../features/calendar-sync/calendar-sync.copy';
import { CALENDAR_STEP_COPY as S } from './calendar-step.copy';


/** Header in the Steam step's shell, with token colours (design-system §2.1) instead of raw emerald. */
function CalendarStepHeader(): JSX.Element {
    return (
        <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-success/15 flex items-center justify-center">
                <CalendarDaysIcon className="w-8 h-8 text-success" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-bold text-foreground">{S.heading}</h2>
            <p className="text-muted mt-2">{S.lede}</p>
        </div>
    );
}

function ConnectedCards({ shown }: { shown: CalendarConnection[] }): JSX.Element {
    const readable = readableConnections(shown);
    return (
        <div className="space-y-3" data-testid="calendar-step-connected">
            <h3 className="text-sm font-semibold text-foreground">{S.connectedHeading}</h3>
            {shown.map((c) => (
                <CalendarConnectionCard key={c.id} connection={c} readSwitch={readable.length > 1}
                    anyReadable={readable.length > 0} showAccount={countOf(shown, c.provider) > 1} />
            ))}
        </div>
    );
}

function ProviderRows({ data }: { data: CalendarsOverview }): JSX.Element {
    return (
        <div className="space-y-3" data-testid="calendar-step-providers">
            <CalendarProviderRow available={data.providers.google.available} returnTarget="onboarding" />
            <AppleProviderRow available={data.providers.apple.available} />
        </div>
    );
}

function CalendarStepBody({ data, isError }: { data: CalendarsOverview | undefined; isError: boolean }): JSX.Element | null {
    if (isError) return <p className="text-sm text-muted text-center">{C.loadError}</p>;
    if (!data) return null;
    if (!data.enabled) return <p className="text-sm text-muted text-center">{C.unavailable}</p>;
    const shown = shippedConnections(data.connections);
    return shown.length > 0 ? <ConnectedCards shown={shown} /> : <ProviderRows data={data} />;
}

export function CalendarStep(): JSX.Element {
    const { data, isError } = useCalendarsOverview();
    const { errorCode, dismissError } = useCalendarOAuthFeedback();
    return (
        <div className="space-y-6" data-testid="calendar-step">
            <CalendarStepHeader />
            {errorCode && <CalendarOAuthErrorBanner code={errorCode} onDismiss={dismissError} />}
            <CalendarStepBody data={data} isError={isError} />
            <p className="text-xs text-muted text-center">{S.manageLater}</p>
        </div>
    );
}
