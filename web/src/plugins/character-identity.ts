/**
 * Character identity hook (ROK-1733): a plugin can own how a game's MANUAL
 * characters are identified (fields, validation, request fields, the label
 * shown where a realm would be). Core forms stay game-agnostic — they ask
 * for the provider by game slug and treat its form value as opaque.
 *
 * Providers register through `PluginHandle.registerCharacterIdentity` and are
 * filtered by active plugin exactly like `PluginSlot`. Core imports this file
 * directly (not via the `plugins` index) so a test that mocks the index does
 * not stub the hooks out.
 */
import { useCallback, type ComponentType } from 'react';
import type { CreateCharacterDto, UpdateCharacterDto } from '@raid-ledger/contract';
import { usePluginStore } from '../stores/plugin-store';
import { getCharacterIdentityRegistration, getCharacterIdentityRegistrations } from './plugin-registry';

export type IdentityErrors = Readonly<Record<string, string | undefined>>;

export interface IdentityFieldsProps<V> {
    value: V;
    onChange: (v: V) => void;
    errors?: IdentityErrors | undefined;
    /** Edit mode: identity parts fixed at creation cannot change. */
    regionLocked?: boolean | undefined;
    /** Smaller controls for the inline signup form. */
    compact?: boolean | undefined;
}

export interface CharacterLocationSource { ruleset?: string | null; region?: string | null }

export interface CharacterIdentityProvider<V = unknown> {
    readonly gameSlugs: readonly string[];
    /** False for a legacy row the plugin does not treat as having an identity. */
    appliesTo(editing?: { region?: string | null } | null): boolean;
    empty(): V;
    fromCharacter(c: { name: string; region?: string | null; ruleset?: string | null } | null | undefined): V;
    same(a: V, b: V): boolean;
    /** Null when valid; otherwise inline messages keyed by field (`name` = the form-level row). */
    validate(v: V): IdentityErrors | null;
    createFields(v: V): Partial<CreateCharacterDto>;
    updateFields(v: V): Partial<UpdateCharacterDto>;
    /** Hide the core Realm input when this provider applies. */
    readonly hidesRealm: boolean;
    readonly Fields: ComponentType<IdentityFieldsProps<V>>;
    /** The label shown where a realm would be (e.g. "PvP (US)"); null when it does not apply. */
    formatLocation(c: CharacterLocationSource): string | null;
}

/** The active provider for a game, or null (no provider, plugin inactive, or a legacy row it skips). */
export function useCharacterIdentity(
    gameSlug: string | null | undefined,
    editing?: { region?: string | null } | null,
): CharacterIdentityProvider | null {
    const activeSlugs = usePluginStore((s) => s.activeSlugs);
    if (!gameSlug) return null;
    const reg = getCharacterIdentityRegistration(gameSlug);
    if (!reg || !activeSlugs.has(reg.pluginSlug)) return null;
    return reg.provider.appliesTo(editing) ? reg.provider : null;
}

/** Slug-free location label: the first non-null label from any active provider. */
export function useCharacterLocationLabel(): (c: CharacterLocationSource) => string | null {
    const activeSlugs = usePluginStore((s) => s.activeSlugs);
    return useCallback((c: CharacterLocationSource) => {
        for (const reg of getCharacterIdentityRegistrations()) {
            if (!activeSlugs.has(reg.pluginSlug)) continue;
            const label = reg.provider.formatLocation(c);
            if (label) return label;
        }
        return null;
    }, [activeSlugs]);
}
