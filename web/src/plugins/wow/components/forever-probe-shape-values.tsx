/**
 * ROK-2143: the flattened leaf values of one public static-data probe shape
 * (quest, quest area, item) — a nested collapsible, collapsed by default, one
 * monospace `path: value` per line. Only public game data carries values;
 * profile shapes stay keys-only.
 */
import type { JSX } from 'react';
import type { ForeverProbeValuesShapeDto } from '@raid-ledger/contract';
import { ScrollCollapsible } from '../../../components/ui/scroll-collapsible';

/** `<n> values`, `<n> of <total> values` when capped, plus a note when nesting was cut. */
function valuesTitle(kept: number, entryCount: number, truncated: boolean): string {
    const count = entryCount > kept ? `${kept} of ${entryCount}` : String(kept);
    return `${count} values${truncated ? ' (depth-limited)' : ''}`;
}

/** Collapsed values list for one shape key; null when there are no values. */
export function ForeverProbeShapeValues({
    shapeKey,
    values,
    entryCount,
    truncated,
}: {
    shapeKey: string;
    values: ForeverProbeValuesShapeDto['values'];
    /** Every leaf the server counted — can exceed the kept values. */
    entryCount: number;
    /** True when the server dropped nesting past its depth limit. */
    truncated: boolean;
}): JSX.Element | null {
    const entries = Object.entries(values);
    if (entries.length === 0) return null;
    return (
        <ScrollCollapsible title={valuesTitle(entries.length, entryCount, truncated)} className="text-xs ml-4">
            <ul aria-label={`${shapeKey} values`} className="font-mono text-xs text-secondary space-y-0.5">
                {entries.map(([path, value]) => (
                    <li key={path} className="break-words">{`${path}: ${String(value)}`}</li>
                ))}
            </ul>
        </ScrollCollapsible>
    );
}
