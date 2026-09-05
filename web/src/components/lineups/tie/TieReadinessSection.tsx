/**
 * Mount point for the readiness card on the lineup page (ROK-1374, AC7).
 *
 * Renders nothing when there is no tie hold, so the page never shows a hole
 * where the grace banner used to be — and never shows both.
 */
import type { JSX } from 'react';
import { useTieReadiness } from '../../../hooks/use-tie-readiness';
import { TieReadinessCard } from './TieReadinessCard';

interface Props {
    lineupId: number;
}

/** The readiness card, when a tie hold exists. */
export function TieReadinessSection({ lineupId }: Props): JSX.Element | null {
    const { data } = useTieReadiness(lineupId);
    if (!data || data.status === 'none') return null;
    return <TieReadinessCard lineupId={lineupId} />;
}
