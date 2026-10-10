/**
 * ROK-1726: the WoW variant badge ("Era", "TBC", "Cata", "Forever") on
 * character cards, rendered through the generic `character-card:badges` slot
 * so core cards carry no WoW knowledge. Manual WoW: Forever characters
 * (`gameVariant: null` + a ruleset) resolve to Forever (OQ3). Retail and
 * non-WoW characters render nothing.
 *
 * ROK-1751: a LedgerLink Forever character carries `gameVariant: null` AND
 * `ruleset: null`, so the card also passes `gameId` and the badge falls back to
 * the game slug from the cached registry. That lookup needs a QueryClient, so
 * it only mounts when one is in context — without a provider the badge simply
 * renders what the variant/ruleset alone resolve to.
 */
import { useContext } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { getWowVariantLabel, resolveWowVariant } from '../lib/wow-variant-config';
import { useCharacterWowVariant } from '../hooks/use-character-wow-variant';

interface CharacterVariantBadgeProps {
    gameVariant?: string | null | undefined;
    ruleset?: string | null | undefined;
    gameId?: number | null | undefined;
}

function VariantLabel({ label }: { label: string | null }) {
    if (!label) return null;
    return (
        <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30 flex-shrink-0">
            {label}
        </span>
    );
}

/** Resolves the variant via the game registry slug (needs a QueryClientProvider). */
function RegistryVariantBadge({ gameVariant, ruleset, gameId }: CharacterVariantBadgeProps) {
    return <VariantLabel label={getWowVariantLabel(useCharacterWowVariant({ gameVariant, ruleset, gameId }).variant)} />;
}

/** Card badge for a character's WoW variant; null for retail / non-WoW characters. */
export function CharacterVariantBadge({ gameVariant, ruleset, gameId }: CharacterVariantBadgeProps) {
    const hasQueryClient = useContext(QueryClientContext) !== undefined;
    const direct = getWowVariantLabel(resolveWowVariant({ gameVariant, ruleset }));
    if (direct || gameId == null || !hasQueryClient) return <VariantLabel label={direct} />;
    return <RegistryVariantBadge gameVariant={gameVariant} ruleset={ruleset} gameId={gameId} />;
}
