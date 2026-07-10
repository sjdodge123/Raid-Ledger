/**
 * LineupAbortedBanner (ROK-1207) — destructive banner surfacing the aborted
 * state on the lineup detail page. Driven by `useLineupAbortedAt`: renders
 * when an admin aborted the lineup, citing the supplied reason if present.
 *
 * The hero already re-tones for aborted lineups (HeroNextStep via
 * useLineupHero / getPhaseState). The banner adds the **reason** so invitees
 * don't have to expand the collapsed activity timeline to see WHY.
 */
import type { JSX } from 'react';
import { MarkdownText } from '../ui/markdown-text';

interface Props {
    abortedAt: string | null;
    reason: string | null;
}

export function LineupAbortedBanner({ abortedAt, reason }: Props): JSX.Element | null {
    if (!abortedAt) return null;

    return (
        <div
            data-testid="lineup-aborted-banner"
            role="status"
            className="mb-4 px-4 py-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-100"
        >
            <p className="text-sm font-semibold text-red-200">
                This lineup was cancelled.
            </p>
            {reason ? (
                <div className="mt-1 text-sm text-red-100/90">
                    <span className="font-medium">Reason:</span>{' '}
                    <span data-testid="lineup-aborted-reason">
                        <MarkdownText text={reason} />
                    </span>
                </div>
            ) : (
                <p className="mt-1 text-sm text-red-100/80">
                    No reason was provided. Nominations and votes are closed.
                </p>
            )}
        </div>
    );
}
