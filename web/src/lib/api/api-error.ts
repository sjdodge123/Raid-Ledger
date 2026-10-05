/**
 * HTTP status on errors thrown by `fetchApi`. The status is attached as a
 * non-enumerable property, so the thrown value stays a plain `Error` for
 * every existing consumer and equality check; callers that handle a specific
 * status inline (e.g. a 409 shown next to the field it concerns) read it here.
 */
export function withHttpStatus(error: Error, status: number): Error {
    Object.defineProperty(error, 'status', { value: status, enumerable: false });
    return error;
}

export function httpStatusOf(error: unknown): number | undefined {
    const status = (error as { status?: unknown } | null)?.status;
    return typeof status === 'number' ? status : undefined;
}

export function isConflictError(error: unknown): boolean {
    return httpStatusOf(error) === 409;
}
