/**
 * ROK-2143: the flattened leaf values of one public static-data probe shape
 * (quest, quest area, item) — a nested collapsible, collapsed by default, one
 * monospace `path: value` per line. Only public game data carries values;
 * profile shapes stay keys-only.
 */
import type { JSX } from 'react';
import type { ForeverProbeValuesShapeDto } from '@raid-ledger/contract';
import { ScrollCollapsible } from '../../../components/ui/scroll-collapsible';

/** Collapsed `<n> values` list for one shape key; null when there are no values. */
export function ForeverProbeShapeValues({
    shapeKey,
    values,
}: {
    shapeKey: string;
    values: ForeverProbeValuesShapeDto['values'];
}): JSX.Element | null {
    const entries = Object.entries(values);
    if (entries.length === 0) return null;
    return (
        <ScrollCollapsible title={`${entries.length} values`} className="text-xs ml-4">
            <ul aria-label={`${shapeKey} values`} className="font-mono text-xs text-secondary space-y-0.5">
                {entries.map(([path, value]) => (
                    <li key={path}>{`${path}: ${String(value)}`}</li>
                ))}
            </ul>
        </ScrollCollapsible>
    );
}
