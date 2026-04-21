import type { JSX } from "react";
import type { GameTasteProfileResponseDto } from "@raid-ledger/contract";
import { useGameTasteProfile } from "../../../hooks/use-game-taste-profile";
import { GameRadarChart } from "./GameRadarChart";
import { AxisBreakdown } from "./AxisBreakdown";

interface GameTasteSectionProps {
    gameId: number | undefined;
}

/**
 * ROK-1082: Game taste profile section on the game-detail page.
 * Renders loading / error / empty / populated states.
 */
export function GameTasteSection({ gameId }: GameTasteSectionProps): JSX.Element {
    const { data, isLoading, isError } = useGameTasteProfile(gameId);
    return (
        <section
            className="mb-8"
            data-testid="game-taste-section"
        >
            <h2 className="text-lg font-semibold text-foreground mb-3">
                Taste Profile
            </h2>
            <GameTasteBody
                isLoading={isLoading}
                isError={isError}
                profile={data}
            />
        </section>
    );
}

interface GameTasteBodyProps {
    isLoading: boolean;
    isError: boolean;
    profile: GameTasteProfileResponseDto | undefined;
}

function GameTasteBody({
    isLoading,
    isError,
    profile,
}: GameTasteBodyProps): JSX.Element {
    if (isLoading) {
        return (
            <div className="text-sm text-muted" data-testid="game-taste-loading">
                Loading taste profile…
            </div>
        );
    }
    if (isError || !profile) {
        return (
            <p className="text-sm text-muted">
                Taste profile is currently unavailable.
            </p>
        );
    }
    if (profile.confidence === 0) {
        return (
            <p className="text-sm text-muted">
                Not enough data yet to generate a taste profile — check back
                once this game has more play history.
            </p>
        );
    }
    return <PopulatedBody profile={profile} />;
}

function PopulatedBody({
    profile,
}: {
    profile: GameTasteProfileResponseDto;
}): JSX.Element {
    const confidencePct = Math.round(profile.confidence * 100);
    return (
        <div className="space-y-4">
            <span
                className="inline-block px-2 py-0.5 bg-panel rounded text-xs text-secondary"
                data-testid="game-taste-confidence"
            >
                Confidence: {confidencePct}%
            </span>
            <GameRadarChart dimensions={profile.dimensions} />
            <AxisBreakdown dimensions={profile.dimensions} />
        </div>
    );
}
