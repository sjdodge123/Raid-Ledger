/**
 * ROK-2187 — "GG <year>" card renderers. Each card in a snapshot is an envelope
 * `{ pluginSlug, cardId, order, payload }`; the plugin that owns `pluginSlug`
 * registers the renderer for `cardId` through `PluginHandle.registerGgCard`.
 * A card is shown only when its renderer exists, its plugin is active and its
 * payload parses with the renderer's schema — anything else is skipped, so a
 * stale or unknown card never breaks the story (short GG, R4).
 */
import type { ComponentType, LazyExoticComponent } from 'react';
import type { GgCardEnvelope } from '@raid-ledger/contract';
import { isSlugActive } from '../stores/plugin-store';

/** The part of a Zod schema the registry needs (web has no direct zod dependency). */
export interface GgPayloadSchema<P> {
    safeParse(input: unknown): { success: true; data: P } | { success: false };
}

/** What a card renderer receives. */
export interface GgCardProps<P = unknown> {
    payload: P;
    year: number;
}

type GgCardComponent<P> = ComponentType<GgCardProps<P>> | LazyExoticComponent<ComponentType<GgCardProps<P>>>;

/** One plugin card renderer. */
export interface GgCardRegistration<P = unknown> {
    /** Matches the envelope `cardId` (and the manifest `gg-card` behaviour id). */
    id: string;
    /** Slide name for the live region, e.g. "Events". */
    label: string;
    /** Tie-break only — the stored envelope `order` sets the story order. */
    order: number;
    /** Usually the contract schema, e.g. `GgValheimCardSchema`. */
    schema: GgPayloadSchema<P>;
    /** The card body; may be `lazy(...)` (a Suspense boundary wraps every card). */
    Component: GgCardComponent<P>;
    /** Ken Burns backdrop image for this card, if any. */
    backgroundSrc?: (payload: P) => string | undefined;
    /** Time on the card before auto-advance (ms). Default: the story's 7 s. */
    durationMs?: number;
}

/** A registration and the plugin that owns it. */
export interface GgCardOwnedRegistration {
    pluginSlug: string;
    card: GgCardRegistration;
}

/** A stored card ready to render. */
export interface ResolvedGgCard {
    key: string;
    pluginSlug: string;
    card: GgCardRegistration;
    payload: unknown;
}

const registry = new Map<string, GgCardOwnedRegistration>();

const keyOf = (pluginSlug: string, cardId: string): string => `${pluginSlug}:${cardId}`;

/** @internal Called by `PluginHandle.registerGgCard`. Re-registering a key replaces it (HMR). */
export function addGgCard<P>(pluginSlug: string, card: GgCardRegistration<P>): void {
    registry.set(keyOf(pluginSlug, card.id), { pluginSlug, card: card as unknown as GgCardRegistration });
}

/** Every GG card registration, regardless of plugin status (the ownership guard reads this). */
export function getGgCardRegistrations(): readonly GgCardOwnedRegistration[] {
    return [...registry.values()];
}

/** @internal Test helper. */
export function clearGgCards(): void {
    registry.clear();
}

function resolveOne(envelope: GgCardEnvelope, active: ReadonlySet<string>): ResolvedGgCard | null {
    const key = keyOf(envelope.pluginSlug, envelope.cardId);
    const owned = registry.get(key);
    if (owned === undefined || !isSlugActive(active, owned.pluginSlug)) return null;
    const parsed = owned.card.schema.safeParse(envelope.payload);
    if (!parsed.success) return null;
    return { key, pluginSlug: owned.pluginSlug, card: owned.card, payload: parsed.data };
}

/** The renderable cards of a snapshot, in envelope order (then registration `order`). */
export function resolveGgCards(cards: readonly GgCardEnvelope[], active: ReadonlySet<string>): ResolvedGgCard[] {
    const sorted = [...cards].sort((a, b) => a.order - b.order);
    const out: ResolvedGgCard[] = [];
    for (const envelope of sorted) {
        const resolved = resolveOne(envelope, active);
        if (resolved !== null) out.push(resolved);
    }
    return out;
}
