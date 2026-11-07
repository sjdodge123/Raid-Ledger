/**
 * ROK-2102: the Forever probe's anonymised response shapes — one line per
 * `<prefix>:<region>:<endpoint>` key with its top-level keys and entry count.
 * The stored `sample` is never rendered. Collapsed by default; hidden when
 * the run recorded no shapes. ROK-2103: a static journal / class index shape
 * also carries public entry `names`, listed in a nested collapsible.
 */
import type { JSX } from 'react';
import { ScrollCollapsible } from '../../../components/ui/scroll-collapsible';
import { ForeverProbeShapeNames } from './forever-probe-shape-names';

interface ProbeShape {
    topLevelKeys: string[];
    entryCount: number;
    names?: string[];
}

/** True when `value` is absent or a string array. */
function isOptionalStringArray(value: unknown): value is string[] | undefined {
    return value === undefined || (Array.isArray(value) && value.every((v) => typeof v === 'string'));
}

/** Narrows one stored shape value; anything malformed is skipped rather than rendered. */
function isProbeShape(value: unknown): value is ProbeShape {
    if (typeof value !== 'object' || value === null) return false;
    const keys: unknown = Reflect.get(value, 'topLevelKeys');
    const count: unknown = Reflect.get(value, 'entryCount');
    return (
        Array.isArray(keys) &&
        keys.every((k) => typeof k === 'string') &&
        typeof count === 'number' &&
        isOptionalStringArray(Reflect.get(value, 'names'))
    );
}

/** Sorted `[key, shape]` pairs whose value is a well-formed shape. */
function shapeEntries(shapes: Record<string, unknown>): [string, ProbeShape][] {
    const out: [string, ProbeShape][] = [];
    for (const key of Object.keys(shapes).sort()) {
        const value = shapes[key];
        if (isProbeShape(value)) out.push([key, value]);
    }
    return out;
}

/** Collapsed list of the probe's response shapes (top-level keys only); null when there are none. */
export function ForeverProbeShapes({
    shapes,
}: {
    shapes: Record<string, unknown>;
}): JSX.Element | null {
    const entries = shapeEntries(shapes);
    if (entries.length === 0) return null;
    return (
        <ScrollCollapsible
            title="Response shapes (top-level keys only)"
            className="text-sm"
        >
            <ul
                aria-label="Response shapes"
                className="text-sm text-secondary space-y-0.5"
            >
                {entries.map(([key, shape]) => (
                    <li key={key}>
                        <code className="text-foreground">{key}</code>:{' '}
                        {shape.topLevelKeys.join(', ')} (entries:{' '}
                        {shape.entryCount})
                        <ForeverProbeShapeNames shapeKey={key} names={shape.names ?? []} />
                    </li>
                ))}
            </ul>
        </ScrollCollapsible>
    );
}
