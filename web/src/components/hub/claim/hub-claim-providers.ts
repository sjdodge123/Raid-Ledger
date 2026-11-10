/**
 * ROK-2153 — plugin-declared "claim your character" providers (web half).
 *
 * A plugin whose api serves a `HubClaimProvider` registers its web side through
 * `PluginHandle.registerHubClaimProvider`: which games × hub kinds it covers,
 * optional copy overrides, and an optional options step shown before a claim
 * (WoW: the ruleset picker). Core owns the one prompt cell that renders it,
 * gated like a Companion prompt: plugin active, game + hub kind match. The
 * ownership guard pins each registration to a manifest `claim-provider`
 * behaviour of the same plugin. One provider per plugin (api D2).
 */
import type { ComponentType } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { GuildPage, HubClaimCandidate, HubClaimResult } from '@raid-ledger/contract';
import type { HubKind } from '../../../plugins/hub-module';
import { isSlugActive } from '../../../stores/plugin-store';

/** Copy overrides for the core prompt; core supplies a default for each. */
export interface HubClaimCopy {
    readonly heading?: string;
    /** Body copy at ≥768px. */
    readonly body?: string;
    /** Shorter body on phone (<768px). Default: `body`. */
    readonly shortBody?: string;
    /** Label of the claim button. */
    readonly cta?: string;
}

/** Props core passes to a provider's options step (rendered before the POST). */
export interface HubClaimOptionsStepProps {
    readonly guildId: number;
    readonly candidate: HubClaimCandidate;
    /** Claim with these provider-validated options (the POST body's `options`). */
    readonly onSubmit: (options: Record<string, unknown>) => void;
    readonly onCancel: () => void;
    /** True while the claim request is in flight. */
    readonly pending: boolean;
}

export interface HubClaimProvider {
    /** Game slugs, matched against `page.guild.gameSlug`. */
    readonly games: readonly string[];
    /** Hub kinds it appears on. */
    readonly kinds: readonly HubKind[];
    readonly copy?: HubClaimCopy;
    /** Shown after a candidate is picked when the status says `claimOptions !== 'none'`. */
    readonly OptionsStep?: ComponentType<HubClaimOptionsStepProps>;
    /** Extra cache work after a successful claim (core invalidations already ran). */
    readonly onClaimed?: (result: HubClaimResult, qc: QueryClient) => void | Promise<void>;
}

export interface HubClaimProviderRegistration {
    readonly pluginSlug: string;
    readonly provider: HubClaimProvider;
}

/** Keyed by plugin slug — one provider per plugin; a re-register (HMR) replaces it. */
const providerRegistry = new Map<string, HubClaimProviderRegistration>();

/** @internal Called by `PluginHandle.registerHubClaimProvider`. */
export function addHubClaimProvider(pluginSlug: string, provider: HubClaimProvider): void {
    providerRegistry.set(pluginSlug, { pluginSlug, provider });
}

/** Every registered provider, regardless of plugin status — callers filter. */
export function getHubClaimProviderRegistrations(): readonly HubClaimProviderRegistration[] {
    return [...providerRegistry.values()];
}

/** @internal Called by `clearRegistry`. */
export function clearHubClaimProviders(): void {
    providerRegistry.clear();
}

/**
 * The one provider this hub may show (first registered wins — a hub has one
 * game, so at most one plugin matches in practice): plugin active, game and
 * kind match. Membership is NOT checked here — the claim status carries
 * `viewerIsMember` (api D4) and the cell gates on it.
 */
export function gatedHubClaimProvider(page: GuildPage, active: ReadonlySet<string>): HubClaimProviderRegistration | undefined {
    const gameSlug = page.guild.gameSlug;
    if (gameSlug === undefined) return undefined;
    return getHubClaimProviderRegistrations().find((r) => isSlugActive(active, r.pluginSlug)
        && r.provider.games.includes(gameSlug)
        && r.provider.kinds.includes(page.guild.kind));
}
