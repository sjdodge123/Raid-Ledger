/**
 * The Games-page lineup banner chrome (extracted from LineupVoteBanner.tsx,
 * which sat on the 300-line cap once ROK-1374's tie states joined it).
 */
import type { JSX } from 'react';
import { JourneyHero } from '../shared/journey-hero';

/**
 * Hero-styled banner with primary + secondary action buttons.
 *
 * Layout mirrors the Sv voting composite's sticky hero: JourneyHero on top
 * (noRibbon — the game-detail page is not a lineup-phase surface so the
 * 4-step ribbon would lie), then a horizontal action row immediately below
 * the toolbar with mobile-friendly tap targets (44px mobile / 36px desktop).
 *
 * Primary action uses the emerald-solid chrome shared with the Sv composite's
 * StickyHeroSubmitButton / Nominating's StickyHeroSearchButton, so the entire
 * site reads as one button family. The secondary "View Lineup" is a ghost
 * outline using the same dimensions.
 */
const PRIMARY_BTN_CLS =
    'flex-1 sm:flex-initial min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-md border border-emerald-500 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-sm font-semibold text-white shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';
const SECONDARY_BTN_CLS =
    'flex-1 sm:flex-initial min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-md border border-edge bg-overlay/30 hover:bg-overlay/50 active:bg-overlay/70 text-sm font-semibold text-foreground transition-colors whitespace-nowrap';

export function BannerHero({
    phase,
    active,
    tone,
    badge,
    task,
    sub,
    primaryLabel,
    primaryDisabled,
    onPrimaryClick,
    secondaryLabel,
    onSecondaryClick,
}: {
    phase: 'nominating' | 'voting' | 'decided';
    active: 0 | 1 | 2;
    tone: 'action' | 'set' | 'waiting';
    badge: string;
    task: string;
    sub?: string;
    primaryLabel?: string;
    primaryDisabled?: boolean;
    onPrimaryClick?: () => void;
    secondaryLabel: string;
    onSecondaryClick: () => void;
}): JSX.Element {
    return (
        <div className="mb-6">
            <JourneyHero
                phase={phase}
                active={active}
                tone={tone}
                badge={badge}
                task={task}
                sub={sub}
                noRibbon
            />
            <div className="flex items-center gap-2 mt-2 px-1">
                {primaryLabel && onPrimaryClick && (
                    <button
                        type="button"
                        onClick={onPrimaryClick}
                        disabled={primaryDisabled}
                        className={PRIMARY_BTN_CLS}
                    >
                        {primaryLabel}
                    </button>
                )}
                <button
                    type="button"
                    onClick={onSecondaryClick}
                    /* When the banner has no primary action (e.g. Nominated /
             Decided / Tiebreaker variants), promote the secondary to the
             primary style — operator review r10d 2026-05-20. */
                    className={
                        primaryLabel && onPrimaryClick
                            ? SECONDARY_BTN_CLS
                            : PRIMARY_BTN_CLS
                    }
                >
                    <span>{secondaryLabel}</span>
                </button>
            </div>
        </div>
    );
}
