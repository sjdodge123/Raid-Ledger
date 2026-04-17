import type { JSX } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { TasteProfileResponseDto } from "@raid-ledger/contract";
import { useTasteProfile } from "../../../hooks/use-taste-profile";
import { TasteRadarChart } from "./TasteRadarChart";
import { IntensityBadge } from "./IntensityBadge";
import { FrequentlyPlaysWith } from "./FrequentlyPlaysWith";
import { isEmptyTasteProfile } from "./taste-profile-helpers";
import "./taste-profile-section.css";

interface TasteProfileSectionProps {
    userId: number;
    /** Optional: allow the parent to pass an already-loaded query result so
     *  we don't double-fetch. When omitted, the section fetches its own. */
    queryResult?: UseQueryResult<TasteProfileResponseDto, Error>;
}

/**
 * Renders a single section heading ("Taste Profile") plus loading /
 * empty / loaded states. Always renders the heading so the Playwright
 * smoke test can latch onto it before data resolves.
 */
export function TasteProfileSection({
    userId,
    queryResult,
}: TasteProfileSectionProps): JSX.Element {
    const ownQuery = useTasteProfile(queryResult ? undefined : userId);
    const query = queryResult ?? ownQuery;
    return (
        <section
            className="user-profile-section taste-profile-section"
            data-testid="taste-profile-section"
        >
            <h2 className="user-profile-section-title">Taste Profile</h2>
            <TasteProfileBody
                isLoading={query.isLoading}
                isError={query.isError}
                profile={query.data}
            />
        </section>
    );
}

interface TasteProfileBodyProps {
    isLoading: boolean;
    isError: boolean;
    profile: TasteProfileResponseDto | undefined;
}

function TasteProfileBody({
    isLoading,
    isError,
    profile,
}: TasteProfileBodyProps): JSX.Element {
    if (isLoading) {
        return <div className="taste-profile-section__loading">Loading…</div>;
    }
    if (isError || !profile) {
        return <EmptyTasteMessage />;
    }
    if (isEmptyTasteProfile(profile)) {
        return <EmptyTasteMessage />;
    }
    return (
        <div className="taste-profile-section__body">
            <TasteRadarChart
                archetype={profile.archetype}
                dimensions={profile.dimensions}
            />
            <IntensityBadge
                archetype={profile.archetype}
                metrics={profile.intensityMetrics}
            />
            <FrequentlyPlaysWith partners={profile.coPlayPartners} />
        </div>
    );
}

function EmptyTasteMessage(): JSX.Element {
    return (
        <p className="taste-profile-section__empty">
            Not enough data yet — play more games!
        </p>
    );
}
