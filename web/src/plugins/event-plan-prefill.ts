/**
 * Plugin event-plan pre-fill (ROK-2215) — the generic host API a plugin uses to
 * resolve a Create Event plan link (`contentInstanceIds`, `inviteCharacterIds`)
 * into the form's initial content selection and the "Will invite" names.
 * Plugins declare through `PluginHandle.registerEventPlanPrefill`; core calls
 * `useEventPlanPrefill(request)`. With no ACTIVE provider the plan is dropped
 * (no pre-fill, no invites). Core carries no game knowledge of its own.
 */
import { usePluginStore, isSlugActive } from '../stores/plugin-store';

/** What core parsed from the plan link. */
export interface EventPlanPrefillRequest {
    gameSlug: string | null;
    guildId: number | null;
    instanceIds: number[];
    inviteCharacterIds: string[];
}

/** Names the provider could resolve for the invite ids, plus how many it could not. */
export interface EventPlanInviteNames {
    names: string[];
    unresolved: number;
}

/** What a provider resolves a request to. */
export interface EventPlanPrefillResult {
    initialInstances: Record<string, unknown>[];
    inviteNames: EventPlanInviteNames;
    /** True while the provider is still fetching what the form seeds from. */
    isLoading: boolean;
}

/** The page-facing result: the provider's result plus the invites core will submit. */
export interface EventPlanPrefill extends EventPlanPrefillResult {
    inviteCharacterIds: string[];
}

/**
 * A provider is a React hook. It is called on every render (inactive → with an
 * empty request), so its hook order never changes.
 */
export type EventPlanPrefillHook = (request: EventPlanPrefillRequest) => EventPlanPrefillResult;

interface ProviderEntry {
    pluginSlug: string;
    usePrefill: EventPlanPrefillHook;
}

/** One provider per app (the first registered wins; re-registering the same plugin replaces it). */
let provider: ProviderEntry | null = null;

const EMPTY_REQUEST: EventPlanPrefillRequest = { gameSlug: null, guildId: null, instanceIds: [], inviteCharacterIds: [] };
const NO_PLAN: EventPlanPrefill = { initialInstances: [], inviteCharacterIds: [], inviteNames: { names: [], unresolved: 0 }, isLoading: false };

/** @internal Called by `PluginHandle.registerEventPlanPrefill` at module load. */
export function addEventPlanPrefillProvider(pluginSlug: string, usePrefill: EventPlanPrefillHook): void {
    if (provider && provider.pluginSlug !== pluginSlug) return;
    provider = { pluginSlug, usePrefill };
}

/** @internal Called by `clearRegistry` (tests). */
export function clearEventPlanPrefillProviders(): void {
    provider = null;
}

/** No provider registered: nothing to resolve (calls no hooks — registration is fixed at module load). */
function useNoPrefill(): EventPlanPrefillResult {
    return NO_PLAN;
}

/** Resolve a plan link through the active provider; no active provider → the plan is dropped. */
export function useEventPlanPrefill(request: EventPlanPrefillRequest): EventPlanPrefill {
    const entry = provider;
    const active = usePluginStore((s) => entry !== null && isSlugActive(s.activeSlugs, entry.pluginSlug));
    const usePrefill = entry?.usePrefill ?? useNoPrefill;
    const result = usePrefill(active ? request : EMPTY_REQUEST);
    if (!active) return NO_PLAN;
    return { ...result, inviteCharacterIds: request.inviteCharacterIds };
}
