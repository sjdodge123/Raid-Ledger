/**
 * ROK-2056 §5 / L4 — plugin-declared "install the Companion" prompts.
 *
 * A plugin whose hub reads Companion uploads registers a prompt through
 * `PluginHandle.registerHubCompanionPrompt`, naming the setup requirement in its
 * own `HUB_PLUGIN_MANIFESTS` entry that carries `rlCompanion` (the ownership
 * guard pins that link). Core owns the one card that renders it
 * (`companion-install-prompt.tsx`), first in the hub Overview, gated like a
 * game widget: plugin active, game + hub kind match, viewer is a member.
 */
import type { GuildPage } from '@raid-ledger/contract';
import type { HubKind } from '../../../plugins/hub-module';
import { audienceAllows } from '../../../plugins/hub-game-widgets';
import { isSlugActive } from '../../../stores/plugin-store';
import { companionDownloadAvailable } from '../../../lib/companion-install';

export interface HubCompanionPrompt {
    /** A requirement id in this plugin's manifest `setup` that carries `rlCompanion`. */
    readonly requirementId: string;
    /** Game slugs, matched against `page.guild.gameSlug`. */
    readonly games: readonly string[];
    /** Hub kinds it appears on. */
    readonly kinds: readonly HubKind[];
    /** Card heading. Default: the requirement's `title`. */
    readonly heading?: string;
    /** Body copy at ≥768px. Default: a line naming the plugin's badge label. */
    readonly body?: string;
    /** Shorter body on phone (<768px). Default: `body`. */
    readonly shortBody?: string;
}

export interface HubCompanionPromptRegistration {
    readonly pluginSlug: string;
    readonly prompt: HubCompanionPrompt;
}

/** Keyed by `pluginSlug:requirementId` — a re-register (HMR) replaces in place. */
const promptRegistry = new Map<string, HubCompanionPromptRegistration>();

/** @internal Called by `PluginHandle.registerHubCompanionPrompt`. */
export function addHubCompanionPrompt(pluginSlug: string, prompt: HubCompanionPrompt): void {
    promptRegistry.set(`${pluginSlug}:${prompt.requirementId}`, { pluginSlug, prompt });
}

/** Every registered prompt, regardless of plugin status — callers filter. */
export function getHubCompanionPromptRegistrations(): readonly HubCompanionPromptRegistration[] {
    return [...promptRegistry.values()];
}

/** @internal Called by `clearRegistry`. */
export function clearHubCompanionPrompts(): void {
    promptRegistry.clear();
}

/**
 * The one prompt this hub may show (first registered wins — a hub has one game,
 * so at most one plugin matches in practice): a public download exists (AC 9),
 * plugin active, game and kind match, viewer is a member (never a visitor).
 * Linked / dismissed are checked by the card, which needs queries for them.
 */
export function gatedHubCompanionPrompt(page: GuildPage, active: ReadonlySet<string>): HubCompanionPromptRegistration | undefined {
    const gameSlug = page.guild.gameSlug;
    if (!companionDownloadAvailable() || gameSlug === undefined || !audienceAllows('members', page.viewer)) return undefined;
    return getHubCompanionPromptRegistrations().find((r) => isSlugActive(active, r.pluginSlug)
        && r.prompt.games.includes(gameSlug)
        && r.prompt.kinds.includes(page.guild.kind));
}
