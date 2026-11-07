/**
 * ROK-2103: the public entry names of one static-index probe shape (journal
 * tiers / instances / classes) — a nested collapsible, collapsed by default,
 * one monospace name per line.
 */
import type { JSX } from 'react';
import { ScrollCollapsible } from '../../../components/ui/scroll-collapsible';

/** Collapsed `<n> names` list for one shape key; null when there are no names. */
export function ForeverProbeShapeNames({
    shapeKey,
    names,
}: {
    shapeKey: string;
    names: readonly string[];
}): JSX.Element | null {
    if (names.length === 0) return null;
    return (
        <ScrollCollapsible title={`${names.length} names`} className="text-xs ml-4">
            <ul aria-label={`${shapeKey} names`} className="font-mono text-xs text-secondary space-y-0.5">
                {names.map((name, i) => (
                    <li key={`${i}-${name}`}>{name}</li>
                ))}
            </ul>
        </ScrollCollapsible>
    );
}
