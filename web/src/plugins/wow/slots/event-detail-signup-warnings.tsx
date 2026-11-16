import type { WowInstanceDetailDto } from '@raid-ledger/contract';
import { getLevelWarning } from '../utils/level-fit';

interface EventDetailSignupWarningsProps {
    characterLevel: number | null | undefined;
    contentInstances: WowInstanceDetailDto[];
    gameSlug: string | null | undefined;
}

/**
 * Computes and renders level warnings for event signups.
 * Checks character level against content instance minimum levels.
 */
export function EventDetailSignupWarnings({
    characterLevel,
    contentInstances,
    gameSlug,
}: EventDetailSignupWarningsProps) {
    const warning = getLevelWarning(characterLevel, contentInstances, gameSlug);
    if (!warning) return null;

    if (warning.type === 'under') {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-warning/10 text-warning border border-warning/20">
                {warning.label}
            </span>
        );
    }

    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-500/15 text-gray-400 border border-gray-500/20">
            {warning.label}
        </span>
    );
}
