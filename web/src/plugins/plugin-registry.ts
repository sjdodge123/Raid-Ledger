import type { ComponentType } from 'react';
import type { CharacterIdentityProvider } from './character-identity';
import type { CalendarLayer, CalendarLayerRegistration } from './calendar-layer';
import { addGameServerProvider, clearGameServerProviders } from './game-server-status';

/** All plugin slot names — each corresponds to a page location */
export type PluginSlotName =
    | 'character-detail:sections'
    | 'character-detail:header-badges'
    /** Owner-only actions in the character page header (ROK-1724). */
    | 'character-detail:owner-actions'
    /** Admin-only actions in the character page header (ROK-1756); context `{ characterId, name, addonLinked }`. */
    | 'character-detail:admin-actions'
    /** Actions above the Add Character form, create only (ROK-1738); context `{ onClose, gameSlug }`. */
    | 'character-create:header-actions'
    | 'character-create:import-form'
    | 'character-create:inline-import'
    | 'event-create:content-browser'
    | 'event-detail:content-sections'
    | 'event-detail:signup-warnings'
    | 'admin-settings:integration-cards'
    | 'admin-settings:plugin-content'
    | 'profile:character-actions'
    | 'character-card:badges'
    /** Desktop header links after the core NAV_LINKS (ROK-1785); context `{ pathname }`. Signed-in only. */
    | 'nav:primary-links'
    /** First block of the phone More drawer (ROK-1785); context `{ onClose }`. Signed-in only. */
    | 'nav:drawer-top'
    /** Items at the top of the header user (avatar) menu, shown from md (ROK-1785); context `{ onClose }`. Signed-in only. */
    | 'user-menu:items'
    /** Cards above New Members on /players (ROK-1785); no context. */
    | 'players:header-cards'
    /** Plugin sections on the game detail page (ROK-1785); context `{ gameId, gameSlug }`. */
    | 'game-detail:sections';

export interface PluginBadgeMeta {
    /** Emoji string, or image URL (starting with "/" or "http") */
    icon: string;
    /** Optional smaller image URL for compact badge contexts */
    iconSmall?: string;
    color: string;
    label: string;
}

export interface SlotRegistration {
    pluginSlug: string;
    slotName: PluginSlotName;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component: ComponentType<any>;
    priority: number;
}

/** Handle returned by registerPlugin() — all slot registrations must go through this */
export interface PluginHandle {
    readonly slug: string;
    registerSlot(
        slotName: PluginSlotName,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        component: ComponentType<any>,
        priority?: number,
    ): void;
    /** Register this plugin's manual-character identity rules for each of `provider.gameSlugs` (ROK-1733). */
    registerCharacterIdentity<V>(provider: CharacterIdentityProvider<V>): void;
    /** Register a calendar layer (windows + markers) drawn only while this plugin is active (ROK-1774). */
    registerCalendarLayer(layer: CalendarLayer): void;
    /** Declare that this plugin feeds `GET /game-servers/status` — core asks for statuses only while it is active (ROK-1776). */
    registerGameServerProvider(): void;
}

/** A character-identity provider and the plugin that owns it — filtered by active plugin like a slot. */
export interface CharacterIdentityRegistration {
    pluginSlug: string;
    provider: CharacterIdentityProvider;
}

/** Module-level registry — populated at import time by plugin register files */
const registry: SlotRegistration[] = [];

/** Badge metadata keyed by plugin slug */
const badgeRegistry = new Map<string, PluginBadgeMeta>();

/** Character-identity providers keyed by game slug — one provider per game */
const identityRegistry = new Map<string, CharacterIdentityRegistration>();

/** Calendar layers keyed by `layer.key` — re-registering a key replaces it (HMR) */
const layerRegistry = new Map<string, CalendarLayerRegistration>();

/** Set by the first `useCalendarLayers` render: its hook order depends on this list staying fixed. */
let layersFrozen = false;

/** @internal Called by `useCalendarLayers` — after this, a NEW layer key throws in dev and is ignored in prod. */
export function freezeCalendarLayers(): void {
    layersFrozen = true;
}

function addCalendarLayer(registration: CalendarLayerRegistration): void {
    const { key } = registration.layer;
    if (layersFrozen && !layerRegistry.has(key)) {
        if (import.meta.env.DEV) {
            throw new Error(
                `Calendar layer "${key}" was registered after the calendar first rendered. ` +
                'Register layers at plugin import time — a late layer would change hook order.',
            );
        }
        return;
    }
    layerRegistry.set(key, registration);
}

/**
 * Register a plugin with badge metadata and receive a handle for slot registration.
 * Plugins MUST call this before registering any slots — the handle enforces this contract.
 */
export function registerPlugin(slug: string, badge: PluginBadgeMeta): PluginHandle {
    badgeRegistry.set(slug, badge);

    return {
        slug,
        registerSlot(slotName, component, priority = 0) {
            registerSlotComponent({
                pluginSlug: slug,
                slotName,
                component,
                priority,
            });
        },
        registerCharacterIdentity(provider) {
            // Core treats the provider's form value as opaque (V = unknown).
            const opaque = provider as unknown as CharacterIdentityProvider;
            for (const gameSlug of provider.gameSlugs) {
                identityRegistry.set(gameSlug, { pluginSlug: slug, provider: opaque });
            }
        },
        registerCalendarLayer(layer) {
            addCalendarLayer({ pluginSlug: slug, layer });
        },
        registerGameServerProvider() {
            addGameServerProvider(slug);
        },
    };
}

/** The identity registration for a game slug, regardless of plugin status — callers filter by active plugin. */
export function getCharacterIdentityRegistration(gameSlug: string): CharacterIdentityRegistration | undefined {
    return identityRegistry.get(gameSlug);
}

/** Every identity registration (one per game slug), regardless of plugin status. */
export function getCharacterIdentityRegistrations(): readonly CharacterIdentityRegistration[] {
    return [...identityRegistry.values()];
}

/** Every calendar layer in registration order, regardless of plugin status — callers filter by active plugin. */
export function getCalendarLayerRegistrations(): readonly CalendarLayerRegistration[] {
    return [...layerRegistry.values()];
}

export function getPluginBadge(slug: string): PluginBadgeMeta | undefined {
    return badgeRegistry.get(slug);
}

/** @internal Used by PluginHandle.registerSlot — prefer using the handle pattern */
export function registerSlotComponent(registration: SlotRegistration): void {
    // De-duplicate: replace existing registration for the same plugin+slot
    // to prevent HMR from accumulating duplicate entries (ROK-206)
    const existingIndex = registry.findIndex(
        (r) =>
            r.pluginSlug === registration.pluginSlug &&
            r.slotName === registration.slotName &&
            r.component === registration.component,
    );
    if (existingIndex !== -1) {
        registry[existingIndex] = registration;
    } else {
        registry.push(registration);
    }
    registry.sort((a, b) => a.priority - b.priority);
}

export function getSlotRegistrations(slotName: PluginSlotName): readonly SlotRegistration[] {
    return registry.filter((r) => r.slotName === slotName);
}

export function clearRegistry(): void {
    registry.length = 0;
    badgeRegistry.clear();
    identityRegistry.clear();
    layerRegistry.clear();
    layersFrozen = false;
    clearGameServerProviders();
}

/** Returns true if the icon string represents an image URL (starts with "/" or "http") */
export function isImageIcon(icon: string): boolean {
    return icon.startsWith('/') || icon.startsWith('http');
}
