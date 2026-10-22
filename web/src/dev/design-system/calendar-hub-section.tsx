/**
 * Hub suffix on event game lines for /dev/design-system (ROK-1893 §10.4,
 * design-system §3.2) — mounts the REAL `EventHubLabel` on the phone agenda
 * row's `text-xs text-muted truncate` game line.
 */
import type { JSX } from 'react';
import { EventHubLabel } from '../../components/calendar/event-hub-label';
import { Section, StateFrame } from './design-system-bits';

const HUB = { id: 7, name: 'BG3 Friends', kind: 'game_community' as const };

export function CalendarHubSection(): JSX.Element {
    return (
        <Section id="calendar-hub" title="Pattern — hub suffix on event game lines"
            blurb="'<game> · <hub>' in the line's own size: text-muted on page surfaces, opacity-80 over game art. Untagged or hidden hubs render nothing (R28).">
            <StateFrame label="Tagged / untagged" note="Truncates with the line; no chip, no new token.">
                {[HUB, null].map((hub) => (
                    <div key={hub ? 'tagged' : 'untagged'} className="truncate rounded-md bg-surface p-2 text-xs text-muted">
                        Baldur&apos;s Gate 3<EventHubLabel hub={hub} />
                    </div>
                ))}
            </StateFrame>
        </Section>
    );
}
