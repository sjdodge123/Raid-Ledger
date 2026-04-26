/**
 * Inline AI status indicator (ROK-1114).
 *
 * Surfaces the AI suggestions query state for any consumer that would
 * otherwise silently render nothing when the provider is mis-configured
 * or returns 503. Used by both `CommonGroundPanel` and the per-user
 * "Suggested for you" row inside `NominateModal`.
 *
 * Returns `null` for the success/idle case so it can sit unconditionally
 * inside a section without polluting the layout.
 */
import { type JSX } from 'react';

export interface AiStatusBannerProps {
    isLoading: boolean;
    isUnavailable: boolean;
    isError: boolean;
}

export function AiStatusBanner({
    isLoading,
    isUnavailable,
    isError,
}: AiStatusBannerProps): JSX.Element | null {
    if (isUnavailable) {
        return (
            <p className="text-xs text-muted">Suggestions temporarily unavailable</p>
        );
    }
    if (isError) {
        return <p className="text-xs text-muted">AI suggestions unavailable</p>;
    }
    if (isLoading) {
        return <p className="text-xs text-muted">AI suggestions loading…</p>;
    }
    return null;
}
