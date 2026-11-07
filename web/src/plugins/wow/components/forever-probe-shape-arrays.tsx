/**
 * ROK-2108: the top-level arrays of one keys-only probe shape (profile extras,
 * guild summary, ruleset detail) — a nested collapsible, collapsed by default,
 * one line per array with its length and its first element's keys. No values.
 */
import type { JSX } from 'react';
import type { ForeverProbeDeepKeysShapeDto } from '@raid-ledger/contract';
import { ScrollCollapsible } from '../../../components/ui/scroll-collapsible';

/** Collapsed `<n> arrays` list for one shape key; null when the shape has no arrays. */
export function ForeverProbeShapeArrays({
    shapeKey,
    shape,
}: {
    shapeKey: string;
    shape: ForeverProbeDeepKeysShapeDto;
}): JSX.Element | null {
    const names = Object.keys(shape.arrayKeys).sort();
    if (names.length === 0) return null;
    const title = `${names.length} ${names.length === 1 ? 'array' : 'arrays'}`;
    return (
        <ScrollCollapsible title={title} className="text-xs ml-4">
            <ul aria-label={`${shapeKey} arrays`} className="text-xs text-secondary space-y-0.5">
                {names.map((name) => (
                    <li key={name}>
                        <code className="text-foreground">{name}</code> (length{' '}
                        {shape.arrayLengths[name] ?? 0}): {(shape.arrayKeys[name] ?? []).join(', ') || 'no keys'}
                    </li>
                ))}
            </ul>
        </ScrollCollapsible>
    );
}
