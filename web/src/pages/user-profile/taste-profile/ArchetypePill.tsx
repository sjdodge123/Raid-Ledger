import type { JSX } from "react";
import type { TasteProfileArchetype } from "@raid-ledger/contract";

type Size = "sm" | "lg";

interface ArchetypePillProps {
    archetype: TasteProfileArchetype;
    /** Pill (`sm`) for header use, hero title (`lg`) for radar overlay. */
    size?: Size;
    className?: string;
}

function toVariant(archetype: TasteProfileArchetype): string {
    // Normalise to a kebab-case CSS token: "Social Drifter" -> "social-drifter".
    return archetype.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Archetype badge shown next to usernames AND above the radar chart.
 * Colour variants are driven by CSS (`taste-profile-section.css`) so the
 * component stays pure and testable.
 */
export function ArchetypePill({
    archetype,
    size = "sm",
    className = "",
}: ArchetypePillProps): JSX.Element {
    const variant = toVariant(archetype);
    const sizeClass =
        size === "lg" ? "archetype-pill--lg" : "archetype-pill--sm";
    return (
        <span
            className={`archetype-pill archetype-pill--${variant} ${sizeClass} ${className}`.trim()}
            data-archetype={archetype}
        >
            {archetype}
        </span>
    );
}
