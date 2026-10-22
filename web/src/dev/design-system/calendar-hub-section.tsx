/**
 * Hub suffix on event game lines for /dev/design-system (ROK-1893 §10.4,
 * design-system §3.2). Mounts the REAL `EventHubLabel` on a page-surface line
 * (the phone agenda row's `text-xs text-muted truncate` game line).
 */
import type { JSX } from 'react';
import { EventHubLabel } from '../../components/calendar/event-hub-label';
import { Section, StateFrame } from './design-system-bits';

const HUB = { id: 7, name: 'BG3 Friends', kind: 'game_community' as const };

function AgendaLine({ title, tagged }: { title: string; tagged: boolean }): JSX.Element {
    return (
        <div className="min-w-0 rounded-md bg-surface p-2">
            <div className="truncate text-sm font-semibold text-foreground">{title}</div>
            <div className="truncate text-xs text-muted">Baldur&apos;s Gate 3<EventHubLabel hub={tagged ? HUB : null} /></div>
        </div>
    );
}

export function CalendarHubSection(): JSX.Element {
    return (
        <Section
            id="calendar-hub"
            title="Pattern — hub suffix on event game lines"
            blurb="An event tagged to a visible hub reads '<game> · <hub>' on its game line (Week/Day compact+standard cards, the phone agenda): plain text in the line's own size, text-muted on page surfaces, opacity-80 over game art. The Week minimal tier and the Month chip carry it in the tooltip/aria-label only. Untagged or hidden-hub events show nothing."
        >
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <StateFrame label="Tagged · EventHubLabel" note="Truncates with the line; no chip, no new token.">
                    <AgendaLine title="Raid night" tagged />
                </StateFrame>
                <StateFrame label="Untagged / hidden hub" note="hub: null renders nothing (R28).">
                    <AgendaLine title="Pick-up session" tagged={false} />
                </StateFrame>
            </div>
        </Section>
    );
}
