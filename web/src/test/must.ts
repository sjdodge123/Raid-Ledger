/**
 * Spec helper (CLAUDE.md strict flags): an indexed or optional read outside `expect(...)` must fail
 * loudly when the element is missing, never fall back to `document.body` or another element.
 */
export function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`missing ${label}`);
    return value;
}
