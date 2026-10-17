/**
 * TiebreakerClosedNotice (ROK-1117).
 * Renders the late-join "Vote closed at HH:MM" empty state shown when the
 * tiebreaker is no longer accepting votes (status: 'resolved' | 'dismissed').
 */
import type { JSX } from 'react';

interface Props {
    title: string;
    resolvedAt: string | null | undefined;
}

function formatClosedTime(resolvedAt: string | null | undefined): string {
    if (!resolvedAt) return '';
    const date = new Date(resolvedAt);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function TiebreakerClosedNotice({ title, resolvedAt }: Props): JSX.Element {
    const closedAt = formatClosedTime(resolvedAt);
    return (
        <div className="mt-4">
            <h3 className="text-base font-semibold text-foreground mb-2">{title}</h3>
            <p data-testid="tiebreaker-vote-closed" className="text-sm text-muted">
                {closedAt ? `Vote closed at ${closedAt}` : 'Vote closed'}
            </p>
        </div>
    );
}
