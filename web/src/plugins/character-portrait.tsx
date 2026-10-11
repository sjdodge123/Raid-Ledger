/**
 * Character portrait seam (ROK-1761): every character-avatar surface in core
 * wraps its existing avatar in `CharacterPortraitFallback`. Each ACTIVE
 * plugin's identity provider may supply a `PortraitFallback` that swaps in its
 * own portrait for the characters it claims (decided from the character's own
 * gameId / gameVariant / ruleset) and renders `children` otherwise. With no
 * provider registered or active, core renders exactly the wrapped avatar.
 *
 * Core imports this file directly (not via the `plugins` index), like
 * `character-identity.ts`.
 */
import type { ComponentType, ReactNode } from 'react';
import { usePluginStore } from '../stores/plugin-store';
import { getCharacterIdentityRegistrations } from './plugin-registry';
import type { CharacterPortraitFallbackProps } from './character-identity';

/** Distinct portrait fallbacks of the active providers (one provider can serve several game slugs). */
function useActivePortraitFallbacks(): ComponentType<CharacterPortraitFallbackProps>[] {
    const activeSlugs = usePluginStore((s) => s.activeSlugs);
    const found = new Set<ComponentType<CharacterPortraitFallbackProps>>();
    for (const reg of getCharacterIdentityRegistrations()) {
        const Fallback = reg.provider.PortraitFallback;
        if (Fallback && activeSlugs.has(reg.pluginSlug)) found.add(Fallback);
    }
    return [...found];
}

/** Character avatar slot: a plugin's portrait when one claims the character, else `children`. */
export function CharacterPortraitFallback({ character, size, children }: CharacterPortraitFallbackProps) {
    const fallbacks = useActivePortraitFallbacks();
    return fallbacks.reduceRight<ReactNode>(
        (inner, Fallback) => <Fallback character={character} size={size}>{inner}</Fallback>,
        children,
    ) as ReactNode;
}
