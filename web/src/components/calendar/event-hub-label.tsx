/**
 * ROK-1893 §10.4 (R23) — the muted ` · <hub>` suffix on an event's game line
 * (Week / Day cards, the phone agenda). Plain text in the line's own type size;
 * renders nothing for an untagged event or a hidden hub (`hub: null`, R28).
 */
import type { EventHubRef } from '@raid-ledger/contract';

interface EventHubLabelProps {
    hub: EventHubRef | null | undefined;
    /**
     * Colour treatment. `text-muted` (default) on page surfaces; game-art
     * cards paint white text on the game colour, so they pass `opacity-80`
     * to dim the inherited colour instead.
     */
    className?: string;
}

export function EventHubLabel({ hub, className = 'text-muted' }: EventHubLabelProps) {
    if (!hub) return null;
    return <span className={className} data-testid="event-hub-label"> · {hub.name}</span>;
}
