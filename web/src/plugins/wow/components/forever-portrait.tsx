/**
 * ROK-1761: the one place a character avatar falls back to the WoW: Forever
 * portrait tile — the class icon on a neutral token disc with a race-initial
 * badge. Every character-avatar surface wraps its existing avatar in
 * `ForeverPortraitFallback`; non-Forever characters, and any character with a
 * render, get the wrapped avatar unchanged.
 *
 * A LedgerLink Forever character can carry `gameVariant: null` AND
 * `ruleset: null` (ROK-1751), so — like `CharacterVariantBadge` — the variant
 * falls back to the cached game registry slug, mounted only when a
 * QueryClient is in context.
 */
import { useContext, useState, type ReactNode } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { resolveWowVariant } from '../lib/wow-variant-config';
import { useCharacterWowVariant } from '../hooks/use-character-wow-variant';
import { selectForeverPortrait, type ForeverPortrait } from '../lib/forever-portrait';
import type { WowVariant } from '../lib/wow-era';

export type ForeverPortraitSize = 'sm' | 'md' | 'lg';

/** Any character-ish shape: CharacterDto fits. */
export interface ForeverPortraitCharacter {
    name: string;
    avatarUrl?: string | null | undefined;
    race?: string | null | undefined;
    class?: string | null | undefined;
    gameVariant?: string | null | undefined;
    ruleset?: string | null | undefined;
    gameId?: number | null | undefined;
}

interface FallbackProps {
    character: ForeverPortraitCharacter;
    size: ForeverPortraitSize;
    /** The surface's existing avatar — rendered for every non-Forever character. */
    children: ReactNode;
}

const SIZES: Record<ForeverPortraitSize, { box: string; icon: string; badge: string }> = {
    sm: { box: 'w-8 h-8', icon: 'w-5 h-5', badge: 'min-w-4 h-4 text-[8px]' },
    md: { box: 'w-10 h-10', icon: 'w-6 h-6', badge: 'min-w-[1.125rem] h-[1.125rem] text-[9px]' },
    lg: { box: 'w-20 h-20', icon: 'w-12 h-12', badge: 'min-w-7 h-7 text-xs' },
};

function NeutralGlyph({ className }: { className: string }) {
    return (
        <svg className={`${className} text-muted`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.118a7.5 7.5 0 0 1 15 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.5-1.632Z" />
        </svg>
    );
}

/** The tile itself. A class icon that fails to load degrades to the neutral glyph — never a broken image. */
export function ForeverPortraitTile({ portrait, size }: { portrait: Exclude<ForeverPortrait, { kind: 'none' }>; size: ForeverPortraitSize }) {
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const s = SIZES[size];
    const iconUrl = portrait.kind === 'neutral' || portrait.classIconUrl === failedUrl ? null : portrait.classIconUrl;
    return (
        <div role="img" aria-label={portrait.label} title={portrait.label} data-testid="forever-portrait" data-portrait={iconUrl ? portrait.kind : 'neutral'}
            className={`${s.box} relative flex-shrink-0 rounded-full bg-overlay border border-edge flex items-center justify-center`}>
            {iconUrl
                ? <img src={iconUrl} alt="" className={`${s.icon} rounded-full object-cover`} onError={() => setFailedUrl(iconUrl)} />
                : <NeutralGlyph className={s.icon} />}
            {portrait.kind === 'tile' && (
                <span aria-hidden="true" data-testid="forever-portrait-race"
                    className={`${s.badge} absolute -bottom-0.5 -right-0.5 px-0.5 rounded-full bg-panel border border-edge-strong text-foreground font-semibold leading-none flex items-center justify-center`}>
                    {portrait.raceInitial}
                </span>
            )}
        </div>
    );
}

function PortraitOrChildren({ variant, character, size, children }: FallbackProps & { variant: WowVariant | null }) {
    const portrait = selectForeverPortrait({
        variant, avatarUrl: character.avatarUrl, race: character.race, characterClass: character.class, name: character.name,
    });
    if (portrait.kind === 'none') return <>{children}</>;
    return <ForeverPortraitTile key={portrait.kind === 'neutral' ? '' : portrait.classIconUrl} portrait={portrait} size={size} />;
}

/** Resolves the variant via the game registry slug (needs a QueryClientProvider). */
function RegistryPortrait(props: FallbackProps) {
    const { gameVariant, ruleset, gameId } = props.character;
    const { variant } = useCharacterWowVariant({ gameVariant, ruleset, gameId });
    return <PortraitOrChildren {...props} variant={variant} />;
}

/** Character avatar slot: the Forever tile when the character has no render, else `children`. */
export function ForeverPortraitFallback(props: FallbackProps) {
    const hasQueryClient = useContext(QueryClientContext) !== undefined;
    const { gameVariant, ruleset, gameId, avatarUrl } = props.character;
    const direct = resolveWowVariant({ gameVariant, ruleset });
    if (direct || avatarUrl || gameId == null || !hasQueryClient) return <PortraitOrChildren {...props} variant={direct} />;
    return <RegistryPortrait {...props} />;
}
