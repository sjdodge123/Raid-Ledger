/**
 * App-entry diet (overnight triage 2026-11-13): the WoW plugin's heavy slot
 * components load on demand. `plugins/wow/register.ts` is imported from
 * `App.tsx`, so every component it registers statically lands in the
 * `app-entry` chunk that every page loads. These slots render only on the
 * event, profile and admin pages, so each one is a `React.lazy` chunk behind its
 * own `<Suspense fallback={null}>` — the same idiom as `CharacterAddonsCard` in
 * `character-detail-sections.tsx` — and `PluginSlot` needs no boundary of its own.
 * Each import goes through `reloadOnChunkError` (reload-once on a stale chunk after
 * a deploy), like the routes and the More drawer. Guarded by
 * `app-entry-lazy-boundaries.guard.test.ts`.
 * The character-create import slots (`import-form`, `inline-import`) stay EAGER in
 * `register.ts`: their first render flips the host to the Import tab, so a lazy
 * chunk would show the manual fields first and then shift the dialog.
 * `CharacterDetailSections` stays eager: as its own chunk it measured 24.1 KB gz,
 * over the 11.3 KB default lazy cap, and budgets are not raised for this diet.
 */
import { lazy, Suspense, type ComponentType, type JSX } from 'react';
import { reloadOnChunkError } from '../../../lib/chunk-error';

/**
 * Wraps a dynamically imported slot component in its own Suspense boundary
 * (fallback `null`, like every other lazy WoW slot section). A stale chunk
 * reloads the page once instead of reaching the root error boundary.
 * @param load - dynamic import of the slot's module
 * @param pick - selects the named slot component from the loaded module
 * @returns a component with the same props that renders nothing until the chunk lands
 */
function lazySlot<M, P extends object>(load: () => Promise<M>, pick: (m: M) => ComponentType<P>): ComponentType<P> {
    const Lazy = lazy(() => reloadOnChunkError(load()).then((m) => ({ default: pick(m) })));
    function LazySlot(props: P): JSX.Element {
        return (
            <Suspense fallback={null}>
                <Lazy {...props} />
            </Suspense>
        );
    }
    return LazySlot;
}

export const EventCreateContentBrowser = lazySlot(() => import('./event-create-content-browser'), (m) => m.EventCreateContentBrowser);
export const EventDetailContentSections = lazySlot(() => import('./event-detail-content-sections'), (m) => m.EventDetailContentSections);
export const BossLootPanel = lazySlot(() => import('./boss-loot-panel'), (m) => m.BossLootPanel);
export const QuestPrepPanel = lazySlot(() => import('./quest-prep-panel'), (m) => m.QuestPrepPanel);
export const BlizzardIntegrationSlot = lazySlot(() => import('./admin-settings-integration-cards'), (m) => m.BlizzardIntegrationSlot);
export const ProfileCharacterActions = lazySlot(() => import('./profile-character-actions'), (m) => m.ProfileCharacterActions);
