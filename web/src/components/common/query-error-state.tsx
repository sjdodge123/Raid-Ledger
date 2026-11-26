/**
 * The shared "couldn't load" state for a failed query (ROK-2342 S3), generalised
 * from the Events page's `EventsErrorState`. A failed list must never fall through
 * to its empty state ("No games found", "No events this week") — that tells the
 * user there is nothing when the server simply failed. Same quiet centred shape as
 * `NotFoundState` (§4.5): a heading, one sentence, a "Try again" button wired to
 * the query's `refetch`, and the raw message tucked into `ErrorDetails`.
 */
import type { JSX } from 'react';
import { Button } from '../ui/button';
import { ErrorDetails } from './error-details';

export const QUERY_ERROR_COPY = 'Something went wrong on our end. Try again in a moment.';

export interface QueryErrorStateProps {
    /** What failed, e.g. "Couldn't load events". */
    title: string;
    /** The query's error; its message goes inside "Technical details". */
    error?: unknown;
    /** Usually the query's `refetch`. Omit to hide the button. */
    onRetry?: (() => unknown) | undefined;
    message?: string | undefined;
    testId?: string | undefined;
    /** Outer spacing; defaults to the §4.5 `py-12`. */
    className?: string | undefined;
}

export function QueryErrorState({
    title, error, onRetry, message = QUERY_ERROR_COPY, testId = 'query-error-state', className = 'py-12',
}: QueryErrorStateProps): JSX.Element {
    return (
        <div role="alert" data-testid={testId} className={`${className} text-center`}>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="mt-2 text-sm text-muted">{message}</p>
            {onRetry && (
                <Button variant="secondary" className="mt-6" onClick={() => void onRetry()}>Try again</Button>
            )}
            <ErrorDetails error={error} />
        </div>
    );
}
