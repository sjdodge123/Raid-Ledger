/**
 * ROK-1726: the WoW variant badge ("Era", "TBC", "Cata", "Forever") on
 * character cards, rendered through the generic `character-card:badges` slot
 * so core cards carry no WoW knowledge. Manual WoW: Forever characters
 * (`gameVariant: null` + a ruleset) resolve to Forever (OQ3). Retail and
 * non-WoW characters render nothing.
 */
import { getWowVariantLabel, resolveWowVariant } from '../lib/wow-variant-config';

interface CharacterVariantBadgeProps {
    gameVariant?: string | null | undefined;
    ruleset?: string | null | undefined;
}

export function CharacterVariantBadge({ gameVariant, ruleset }: CharacterVariantBadgeProps) {
    const label = getWowVariantLabel(resolveWowVariant({ gameVariant, ruleset }));
    if (!label) return null;
    return (
        <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30 flex-shrink-0">
            {label}
        </span>
    );
}
