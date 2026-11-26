/** The message of an Error (or a non-empty string), else null (ROK-2342). */
export function errorText(error: unknown): string | null {
    if (error instanceof Error) return error.message || null;
    if (typeof error === 'string') return error || null;
    return null;
}
