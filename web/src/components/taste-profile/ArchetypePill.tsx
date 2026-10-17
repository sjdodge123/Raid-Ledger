import type { JSX } from "react";
import type { ArchetypeDto } from "@raid-ledger/contract";
import { composeArchetypeLabel } from "./taste-profile-helpers";

type Size = "sm" | "lg";

interface ArchetypePillProps {
    archetype: ArchetypeDto;
    /** Pill (`sm`) for header use, hero title (`lg`) for radar overlay. */
    size?: Size;
    className?: string;
}

/**
 * Archetype badge shown next to usernames AND above the radar chart.
 *
 * ROK-1083: the pill renders the composed stacked label
 * (`"Hardcore Raider"`, `"Hardcore Hero & Raider"`, or `"Hardcore Player"`
 * when no titles apply). Colour variants are driven by CSS keyed off the
 * intensity tier (`taste-profile-section.css`) so the component stays
 * pure and testable.
 */
export function ArchetypePill({
    archetype,
    size = "sm",
    className = "",
}: ArchetypePillProps): JSX.Element {
    const tierClass = `archetype-pill--tier-${archetype.intensityTier.toLowerCase()}`;
    const sizeClass =
        size === "lg" ? "archetype-pill--lg" : "archetype-pill--sm";
    const label = composeArchetypeLabel(archetype);
    return (
        <span
            className={`archetype-pill ${tierClass} ${sizeClass} ${className}`.trim()}
            data-tier={archetype.intensityTier}
            data-vector-titles={archetype.vectorTitles.join(",")}
        >
            {label}
        </span>
    );
}
