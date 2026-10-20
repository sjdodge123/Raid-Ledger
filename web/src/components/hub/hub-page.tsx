/**
 * ROK-1785/ROK-1830 — `/guilds/:id`: the game-agnostic hub shell — hero +
 * `TabRow` + the active tab. Game-specific tabs, widgets, member columns and
 * hero pills come from the hub module registered for `guild.kind`
 * (`web/src/plugins/hub-module.ts`); core never imports a plugin.
 * Resources is core's own tab, shown once it has content, the viewer can edit
 * it, or a module section reports content of its own (ROK-1830 — core asks
 * through `HubModSource.useVisible` during render, above the tab nav, so
 * a warm cache needs no second commit; it runs no plugin query itself).
 * A 403 (not a member) is a friendly empty state.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { GuildPage as GuildPageDto } from '@raid-ledger/contract';
import { Button } from '../ui/button';
import { TabRow } from '../ui/tab-row';
import { tabPanelId, useHashTab } from '../ui/tab-row.helpers';
import { httpStatusOf } from '../../lib/api/api-error';
import { type HubCtx, type HubModSource, type HubModule, useHubModule, useHubModulePending } from '../../plugins/hub-module';
import { HubHero } from './hub-hero';
import { HubOverview, type ModsState } from './hub-overview';
import { resourcesVisible } from './content/guild-content.helpers';
import { GuildResources } from './content/guild-resources';
import { HUB_TAB_HASH_ALIASES, hubTabLabel, hubTabs, visibleHubTabIds, type HubTabEntry } from './hub-tabs';
import { HubMembers } from './hub-members';
import { HubEventsTab } from './events/events-tab';
import { useGuildPage, useGuildRaids } from './api/use-guild';
import { useGuildProfile } from './api/use-guild-content';
import { usePluginsHydrated } from '../../hooks/use-plugins';
import { HubResourceVisibility } from './hub-resource-visibility';
import { HubSettingsProvider, type HubSettingsValue } from './settings/hub-settings-context';
import { HubSettingsTrigger } from './settings/settings-trigger';
import { canOpenHubSettings } from './settings/settings-access';
import { HubNotifyBell } from './hub-notify-bell';
import { hubBellVisible } from './hub-notify-bell.helpers';

/** Leader/admin only and opened on demand, so neither chunk rides in the page bundle. */
const HubSettingsSheet = lazy(() => import('./settings/settings-sheet').then((m) => ({ default: m.HubSettingsSheet })));
const HubDiscordPickerMount = lazy(() => import('./discord/discord-picker-mount').then((m) => ({ default: m.HubDiscordPickerMount })));

const PAGE = 'max-w-5xl mx-auto px-4 py-8';

/** Stable identity so the source list doesn't churn while a module is absent. */
const NO_SECTIONS: readonly HubModSource[] = [];

function Notice({ testId, children }: { testId: string; children: ReactNode }): JSX.Element {
    return <div className={PAGE}><div data-testid={testId} className="py-12 text-center">{children}</div></div>;
}

function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }): JSX.Element {
    const status = httpStatusOf(error);
    if (status === 403) {
        return <Notice testId="guild-not-member"><p className="text-sm text-muted">You&apos;re not a member of this guild. Link a character in the guild to see its page.</p></Notice>;
    }
    if (status === 404) {
        return <Notice testId="guild-not-found"><p className="text-sm text-muted">This guild doesn&apos;t exist. Check the link and try again.</p></Notice>;
    }
    return (
        <Notice testId="guild-error">
            <p className="mb-4 text-sm text-muted">We couldn&apos;t load this guild. Try again in a moment.</p>
            <Button variant="secondary" onClick={onRetry}>Try again</Button>
        </Notice>
    );
}

function LoadingState(): JSX.Element {
    return (
        <div className={PAGE} aria-busy="true" data-testid="guild-loading">
            <div className="mb-4 h-28 animate-pulse rounded-xl border border-edge bg-panel" />
            <div className="h-64 animate-pulse rounded-lg border border-edge bg-surface" />
        </div>
    );
}

interface PanelProps {
    active: string;
    ctx: HubCtx;
    module: HubModule | undefined;
    tabs: readonly HubTabEntry[];
    /** A mod source reports content — the setup checklist's "Recommend mods" step (ROK-1830 S5b). */
    mods: ModsState;
}

function ActiveTab({ active, ctx, module: mod, mods }: Omit<PanelProps, 'tabs'>): JSX.Element {
    const { page } = ctx;
    if (active === 'members') return <HubMembers ctx={ctx} module={mod} />;
    if (active === 'events') return <HubEventsTab query={ctx.raids} kind={ctx.page.guild.kind} />;
    if (active === 'resources') return <GuildResources guildId={page.guild.id} canEdit={page.viewer.canEdit} module={mod} />;
    const tab = mod?.tabs.find((t) => t.id === active);
    if (tab) return <tab.component {...ctx} />;
    return <HubOverview ctx={ctx} module={mod} mods={mods} />;
}

/** Scroll the panel top back into view when a tab switch happens below it (prototype `GuildTabPanel`). */
function TabPanel({ active, ctx, module: mod, tabs, mods }: PanelProps): JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
    }, [active]);
    return (
        <div ref={ref} id={tabPanelId('guild', active)} role="region" aria-label={hubTabLabel(tabs, active)} className="scroll-mt-4">
            <ActiveTab active={active} ctx={ctx} module={mod} mods={mods} />
        </div>
    );
}

/**
 * One overlay at a time. The picker REPLACES the sheet rather than stacking on
 * it: two dialogs deep is a shell the inventory doesn't have, and the sheet has
 * nothing in flight — so a single state, not two booleans that can both be true.
 */
type HubOverlay = 'closed' | 'settings' | 'picker';

interface OverlayProps {
    ctx: HubCtx;
    module: HubModule | undefined;
    overlay: HubOverlay;
    onClose: () => void;
    openPicker: () => void;
}

function HubOverlays({ ctx, module: mod, overlay, onClose, openPicker }: OverlayProps): JSX.Element {
    return (
        <Suspense fallback={null}>
            {overlay === 'settings' && <HubSettingsSheet ctx={ctx} module={mod} onClose={onClose} onChangeChannel={openPicker} />}
            {overlay === 'picker' && <HubDiscordPickerMount guildId={ctx.page.guild.id} onClose={onClose} />}
        </Suspense>
    );
}

/** The sheet, the picker it opens, and the hero trigger that starts both (ROK-1830 S4). */
function useHubSettingsState(canManage: boolean) {
    const [requested, setRequested] = useState<HubOverlay>('closed');
    const openPicker = useCallback(() => setRequested('picker'), []);
    const openSettings = useCallback(() => setRequested('settings'), []);
    const onClose = useCallback(() => setRequested('closed'), []);
    // Both overlays are Leader-only, so the rights gate the RENDER rather than
    // an effect that resets the state: a refetched page that demotes the viewer
    // mid-session takes the open dialog off the screen in the same commit, and
    // nothing cascades. (The stale request is harmless — a re-promoted viewer
    // reopens from the trigger.)
    const overlay: HubOverlay = canManage ? requested : 'closed';
    const value: HubSettingsValue = useMemo(
        () => ({ openChannelPicker: canManage ? openPicker : null }), [canManage, openPicker]);
    return { overlay, openPicker, onClose, openSettings, value };
}

interface FrameProps {
    ctx: HubCtx;
    module: HubModule | undefined;
    showResources: boolean;
    mods: ModsState;
}

/** Hero + tab nav + panel. Rendered under `HubResourceVisibility`, so `showResources` is already settled. */
function HubFrame({ ctx, module: mod, showResources, mods }: FrameProps): JSX.Element {
    const tabs = hubTabs(mod, ctx, showResources);
    const [active] = useHashTab(visibleHubTabIds(tabs), 'overview', HUB_TAB_HASH_ALIASES);
    const canManage = canOpenHubSettings(ctx.page);
    const s = useHubSettingsState(canManage);
    return (
        <HubSettingsProvider value={s.value}>
            <div className={PAGE}>
                <HubHero ctx={ctx} module={mod} nextRaid={ctx.raids.data?.nextRaid ?? null}
                    action={canManage || hubBellVisible(ctx.page.viewer) ? (
                        <div className="flex items-center gap-2">
                            <HubNotifyBell page={ctx.page} />
                            {canManage && <HubSettingsTrigger onOpen={s.openSettings} />}
                        </div>
                    ) : null} />
                <TabRow tabs={tabs} activeId={active} label="Guild page sections" className="mb-6" />
                <TabPanel active={active} ctx={ctx} module={mod} tabs={tabs} mods={mods} />
                <HubOverlays ctx={ctx} module={mod} overlay={s.overlay} onClose={s.onClose} openPicker={s.openPicker} />
            </div>
        </HubSettingsProvider>
    );
}

function GuildPageBody({ page }: { page: GuildPageDto }): JSX.Element {
    const raids = useGuildRaids(page.guild.id);
    const mod = useHubModule(page.guild.kind);
    const profile = useGuildProfile(page.guild.id);
    const coreResources = resourcesVisible(page.viewer.canEdit, profile.data);
    const sources = mod?.modSources ?? NO_SECTIONS;
    const ctx: HubCtx = { page, raids };
    // The module sections answer during THIS render pass, above the tab nav, so
    // a warm cache puts Resources in the first commit (see hub-resource-visibility).
    return (
        <HubResourceVisibility sections={sources} guildId={page.guild.id}>
            {/* Lead ruling 3: a hub kind with NO mod sources never shows the
                "Recommend mods" step — `anyVisible` is false forever there, so
                the checklist could otherwise never finish. */}
            {(anyVisible) => <HubFrame ctx={ctx} module={mod} showResources={coreResources || anyVisible}
                mods={{ hasSources: sources.length > 0, configured: anyVisible }} />}
        </HubResourceVisibility>
    );
}

export function GuildPage(): JSX.Element {
    const { id } = useParams<{ id: string }>();
    const guildId = Number(id);
    const query = useGuildPage(Number.isInteger(guildId) ? guildId : 0);
    // The module decides the tab set, so there is nothing worth drawing before
    // the plugin list has settled — and drawing it would remount the frame when
    // the module arrives (see `HubResourceVisibility`).
    const pluginsHydrated = usePluginsHydrated();
    // A community hub's module is its own lazy chunk — hold the skeleton until it lands.
    const modulePending = useHubModulePending(query.data?.guild.kind);
    if (!Number.isInteger(guildId) || guildId <= 0) {
        return <Notice testId="guild-not-found"><p className="text-sm text-muted">This guild doesn&apos;t exist. Check the link and try again.</p></Notice>;
    }
    if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
    if (!query.data || !pluginsHydrated || modulePending) return <LoadingState />;
    return <GuildPageBody page={query.data} />;
}
