/**
 * Typed partial hook result for `vi.mocked(useX).mockReturnValue(...)`.
 *
 * Every field given is checked against T; the fields left out are the ones
 * the component under test never reads. Prefer a complete result (or a
 * factory) when the component reads most of the hook's fields.
 */
export function partialResult<T>(fields: Partial<T>): T {
    return fields as T;
}
