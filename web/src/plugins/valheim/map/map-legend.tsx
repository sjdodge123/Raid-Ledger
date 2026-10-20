/**
 * ROK-1837 — the map's fog legend (bottom-left overlay) and the snapshot
 * footer under it, per the approved prototype (`.maplegend`, `.foot`). The
 * swatches are the fog's own tones: `--color-backdrop` at the alphas
 * `fog-bitmap.ts` paints (0 / 0.45 / 0.92) — token utilities only.
 */
import { format, formatDistanceToNow } from 'date-fns';

const SWATCHES = [
    { text: 'Explored', tone: 'bg-transparent' },
    { text: 'Cartography table', tone: 'bg-backdrop/45' },
    { text: 'Unexplored', tone: 'bg-backdrop/92' },
] as const;

/** Bottom-left swatch legend; stays clear of the top-right controls. */
export function MapLegend() {
    return (
        <ul
            aria-label="Map legend"
            className="pointer-events-none absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-4.5rem)] flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border border-edge bg-surface/90 px-2.5 py-1 text-xs text-foreground"
        >
            {SWATCHES.map(({ text, tone }) => (
                <li key={text} className="flex items-center gap-1">
                    <span
                        aria-hidden="true"
                        data-fog-swatch
                        className={`inline-block h-3 w-3 rounded-sm border border-edge-strong ${tone}`}
                    />
                    {text}
                </li>
            ))}
        </ul>
    );
}

/** `Latest snapshot · captured <relative>` with the absolute time as a tooltip. */
export function MapSnapshotFooter({ capturedAt }: { capturedAt: string }) {
    const at = new Date(capturedAt);
    return (
        <p className="text-xs text-dim">
            Latest snapshot · captured{' '}
            <time dateTime={capturedAt} title={format(at, 'PPpp')}>
                {formatDistanceToNow(at, { addSuffix: true })}
            </time>
        </p>
    );
}
