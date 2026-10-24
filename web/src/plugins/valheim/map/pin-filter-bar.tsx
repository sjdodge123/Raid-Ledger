/**
 * ROK-1930 Q7 — the line above a filtered map: what is shown, an empty state
 * when there is nothing to draw, and a way back to every pin (someone who
 * arrived by deep link can leave the filter).
 */
import type { JSX } from 'react';
import { Button } from '../../../components/ui/button';
import type { PinFilterBarState } from './use-pin-filter';

const SCOPE_TEXT = {
    character: "Showing this character's death pins",
    server: "Showing every player's death pins",
} as const;

export function PinFilterBar({ scope, count, loading, onClear }: PinFilterBarState): JSX.Element {
    const empty = !loading && count === 0;
    return (
        <div className="flex flex-wrap items-center justify-between gap-2" data-testid="map-pin-filter">
            <p role="status" className="text-sm text-muted">
                {SCOPE_TEXT[scope]}
                {empty && <span className="text-foreground"> · No death pins on this map yet.</span>}
            </p>
            <Button variant="ghost" size="md" onClick={onClear}>
                Show every pin
            </Button>
        </div>
    );
}
