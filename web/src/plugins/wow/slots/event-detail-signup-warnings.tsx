import type { WowInstanceDetailDto } from '@raid-ledger/contract';

interface LevelWarning {
    type: 'under' | 'over';
    label: string;
}

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
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
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

function getLevelWarning(
    characterLevel: number | null | undefined,
    contentInstances: WowInstanceDetailDto[],
    gameSlug: string | null | undefined,
): LevelWarning | null {
    if (characterLevel == null) return null;

    const minimumLevels = contentInstances
        .map((i) => i.minimumLevel)
        .filter((l): l is number => l != null);
    const lowestMinLevel = minimumLevels.length > 0 ? Math.min(...minimumLevels) : null;

    if (lowestMinLevel == null) return null;

    if (characterLevel < lowestMinLevel) {
        return { type: 'under', label: `Below min level (${lowestMinLevel})` };
    }
    if (gameSlug === 'world-of-warcraft-classic' && characterLevel > lowestMinLevel + 20) {
        return { type: 'over', label: 'Over-leveled for this content' };
    }
    return null;
}
