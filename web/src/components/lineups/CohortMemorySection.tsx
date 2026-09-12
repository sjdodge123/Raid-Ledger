/**
 * "Played with this group before" section (ROK-1309).
 *
 * Renders below the Common Ground list on the nominate/vote page and shows the
 * games this lineup's exact engaged cohort has already resolved. Hidden
 * entirely when the endpoint returns no entries.
 *
 * Deliberately self-fetching rather than prop-driven: `NominatingComposite` is
 * within a few lines of the 300-counted-line ESLint cap, so the mount there is
 * a single JSX element. Card chrome reuses the same `game-card-parts`
 * primitives as `CommonGroundGameCard` — no new visual language (the story
 * lists a Common Ground UI redesign as out of scope).
 */
import type { JSX } from 'react';
import type { CohortMemoryEntryDto } from '@raid-ledger/contract';
import {
    CoverImage,
    CoverPlaceholder,
    GradientOverlay,
    CardTitle,
} from '../games/game-card-parts';
import { useLineupCohortMemory, useNominateGame } from '../../hooks/use-lineups';

type Resolution = CohortMemoryEntryDto['resolution'];

/** Badge copy per positive outcome. `veto_lost` is filtered server-side. */
const BADGE_LABEL: Record<Resolution, string> = {
    decided: 'Decided',
    match: 'Match',
    veto_won: 'Veto won',
};

const BADGE_CLASS: Record<Resolution, string> = {
    decided: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    match: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    veto_won: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
};

/** Human-readable last-resolved date; falls back to the raw value. */
function formatResolvedAt(iso: string): string {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

/** Small outcome badge in the card's top-left corner. */
function ResolutionBadge({ resolution }: { resolution: Resolution }): JSX.Element {
    return (
        <span
            className={`absolute top-2 left-2 px-2 py-0.5 rounded-md border text-[10px] font-semibold ${BADGE_CLASS[resolution]}`}
        >
            {BADGE_LABEL[resolution]}
        </span>
    );
}

/** Title + last-resolved date, over the cover's gradient. */
function CardCaption({ entry }: { entry: CohortMemoryEntryDto }): JSX.Element {
    return (
        <div className="absolute bottom-0 left-0 right-0 p-3">
            <CardTitle name={entry.gameName} />
            <time
                data-testid="cohort-memory-resolved-at"
                dateTime={entry.lastResolvedAt}
                className="mt-1 block text-[11px] text-white/70"
            >
                {formatResolvedAt(entry.lastResolvedAt)}
            </time>
        </div>
    );
}

/** One remembered game. Clicking it nominates that game into this lineup. */
function CohortMemoryCard({
    entry,
    onNominate,
    disabled,
}: {
    entry: CohortMemoryEntryDto;
    onNominate: (gameId: number) => void;
    disabled: boolean;
}): JSX.Element {
    return (
        <button
            type="button"
            data-testid={`cohort-memory-card-${entry.gameId}`}
            onClick={() => onNominate(entry.gameId)}
            disabled={disabled}
            className="group relative w-full text-left rounded-xl overflow-hidden bg-panel border border-edge/50 hover:border-emerald-500/50 hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
            <div className="relative aspect-[3/4] bg-panel overflow-hidden">
                {entry.gameCoverUrl
                    ? <CoverImage src={entry.gameCoverUrl} alt={entry.gameName} />
                    : <CoverPlaceholder />}
                <ResolutionBadge resolution={entry.resolution} />
                <GradientOverlay />
                <CardCaption entry={entry} />
            </div>
        </button>
    );
}

export interface CohortMemorySectionProps {
    lineupId: number;
    /** False for private-lineup non-invitees — cards render but don't nominate. */
    canParticipate: boolean;
}

/** "Played with this group before" — renders nothing when the cohort is new. */
export function CohortMemorySection({
    lineupId,
    canParticipate,
}: CohortMemorySectionProps): JSX.Element | null {
    const { data } = useLineupCohortMemory(lineupId);
    const nominate = useNominateGame();
    const entries = data?.entries ?? [];

    if (entries.length === 0) return null;

    const handleNominate = (gameId: number): void => {
        if (!canParticipate) return;
        nominate.mutate({ lineupId, body: { gameId } });
    };

    return (
        <section
            role="region"
            aria-label="Played with this group before"
            data-testid="cohort-memory-section"
            className="space-y-2"
        >
            <h3 className="text-base sm:text-lg font-semibold text-foreground">
                Played with this group before
            </h3>
            <div className="grid gap-3 pb-2 [grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr))] md:[grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
                {entries.map((entry) => (
                    <CohortMemoryCard
                        key={entry.gameId}
                        entry={entry}
                        onNominate={handleNominate}
                        disabled={!canParticipate || nominate.isPending}
                    />
                ))}
            </div>
        </section>
    );
}
