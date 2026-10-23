/**
 * Plugin event report links — the generic host API a plugin uses to declare
 * which of its games take a combat-log report link on the event detail page
 * (the core "Logs" card). Plugins declare through
 * `PluginHandle.registerEventReportLinks`; core asks
 * `useEventReportLinksSupported(gameSlug)` whether an ACTIVE declaring plugin
 * claims the event's game. Core carries no game knowledge of its own.
 */
import { usePluginStore } from '../stores/plugin-store';

/** True when a plugin's game (by slug) supports event report links. */
export type EventReportLinkPredicate = (gameSlug: string) => boolean;

/** Report-link predicates keyed by declaring plugin slug — one per plugin (HMR replaces). */
const predicates = new Map<string, EventReportLinkPredicate>();

/** @internal Called by `PluginHandle.registerEventReportLinks`. */
export function addEventReportLinkPredicate(pluginSlug: string, supports: EventReportLinkPredicate): void {
    predicates.set(pluginSlug, supports);
}

/** @internal Called by `clearRegistry` (tests). */
export function clearEventReportLinkPredicates(): void {
    predicates.clear();
}

/** True iff an active plugin declares report-link support for `gameSlug`. No game → false. */
export function useEventReportLinksSupported(gameSlug: string | null | undefined): boolean {
    return usePluginStore((s) => {
        if (!gameSlug) return false;
        for (const [pluginSlug, supports] of predicates) {
            if (s.activeSlugs.has(pluginSlug) && supports(gameSlug)) return true;
        }
        return false;
    });
}
