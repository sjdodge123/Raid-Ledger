/**
 * ROK-2140: join the parts that are actually present with a separator, so a
 * missing race/spec/realm never leaves a leading or trailing "·".
 *
 * @param parts - candidate parts; null, undefined, false and blank strings are dropped
 * @param separator - placed only BETWEEN present parts (default " · ")
 * @returns the joined string, or "" when nothing is present
 */
export function compactJoin(parts: ReadonlyArray<string | null | undefined | false>, separator = ' · '): string {
    return parts
        .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
        .join(separator);
}
