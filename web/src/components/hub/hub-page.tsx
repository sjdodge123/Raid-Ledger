/**
 * ROK-1785/ROK-1830 — `/hubs/:id` (was `/guilds/:id`, ROK-1891): the game-agnostic hub shell — hero +
 * `TabRow` + the active tab. Game-specific tabs, widgets, member columns and
 * hero pills come from the hub module registered for `guild.kind`
 * (`web/src/plugins/hub-module.ts`); core never imports a plugin.
 * Resources is core's own tab, shown once it has content, the viewer can edit
 * it, or a module section reports content of its own (ROK-1830 — core asks
 * through `HubModSource.useVisible` during render, above the tab nav, so
 * a warm cache needs no second commit; it runs no plugin query itself).
 * A 403 (not a member — ROK-2132 a module's join gate — or ROK-2044 the hub's plugin is off) is a friendly empty state (`hub-page-error.tsx`); a 401 that survived the
 * refresh re-checks the session — sign in only once it is rejected (ROK-1947).
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import type { GuildPage as GuildPageDto } from '@raid-ledger/contract';
import { Button } from '../ui/button';
import { TabRow } from '../ui/tab-row';
import { tabPanelId, useHashTab } from '../ui/tab-row.helpers';
import { httpStatusOf } from '../../lib/api/api-error';
import { type HubCtx, type HubModSource, type HubModule, useHubModule, useHubModuleLoadError, useHubModulePending, retryHubModuleLoad } from '../../plugins/hub-module';
import { HubGalleryDialogMount } from './gallery/hub-gallery-dialog-mount';
import { HubHero } from './hub-hero';
import { HubOverview, type ModsState } from './hub-overview';
import { resourcesVisible } from './content/guild-content.helpers';
import { GuildResources } from './content/guild-resources';
import { postIdFromSearch } from './posts/post-link';
import { HUB_TAB_HASH_ALIASES, hubModuleTabs, hubTabLabel, hubTabs, visibleHubTabIds, type HubTabEntry } from './hub-tabs';
import { HubMembers } from './hub-members';
import { HubEventsTab } from './events/events-tab';
import { useGuildPage, useGuildRaids } from './api/use-guild';
import { useGuildProfile } from './api/use-guild-content';
import { usePluginsHydrated } from '../../hooks/use-plugins';
import { HubResourceVisibility } from './hub-resource-visibility';
import { HubSettingsProvider, type HubSettingsValue } from './settings/hub-settings-context';
import { HubSettingsTrigger } from './settings/settings-trigger';
import { hubCopy, hubSectionsLabel } from './hub-copy';
import { canOpenHubSettings, canUseHubChannelPicker } from './settings/settings-access';
import { HubNotifyBell } from './hub-notify-bell';
import { hubBellVisible } from './hub-notify-bell.helpers';
import { useSignInAgain } from './use-sign-in-again';
import { useSessionRecheck, type RecoveryResult } from './use-session-recheck';
import { ErrorState, LoadingState, Notice, NotFoundNotice, PAGE } from './hub-page-error';

/** Re-exported for the page's existing specs (moved to `hub-page-error.tsx`, ROK-2132). */
export { ErrorState };

/** Leader/admin only and opened on demand, so neither chunk rides in the page bundle. */
const HubSettingsSheet = lazy(() => import('./settings/settings-sheet').then((m) => ({ default: m.HubSettingsSheet })));
/** ROK-1868 — the Posts tab (feed, composer, deep link) loads only when opened. */
const HubPostsTab = lazy(() => import('./posts/posts-tab').then((m) => ({ default: m.HubPostsTab })));
const HubDiscordPickerMount = lazy(() => import('./discord/discord-picker-mount').then((m) => ({ default: m.HubDiscordPickerMount })));

/** Stable identity so the source list doesn't churn while a module is absent. */
const NO_SECTIONS: readonly HubModSource[] = [];

/** ROK-1947: the session is over — Sign in ends it and returns here after. */
function SignInPrompt(): JSX.Element {
    const signIn = useSignInAgain();
    return (
        <Notice testId="guild-session-expired">
            <p className="mb-4 text-sm text-muted">Your session expired. Sign in again to see this hub.</p>
            <Button onClick={signIn}>Sign in</Button>
        </Notice>
    );
}

/**
 * ROK-1947: a 401 that outlived the transparent refresh. Re-check the session
 * first — only a REJECTED refresh offers a sign-in; a blip offers a retry.
 */
function SessionExpired({ onRecovered }: { onRecovered: () => Promise<RecoveryResult> }): JSX.Element {
    const { state, retry } = useSessionRecheck(onRecovered);
    if (state === 'checking') return <LoadingState />;
    if (state === 'rejected') return <SignInPrompt />;
    return (
        <Notice testId="guild-session-unreachable">
            <p className="mb-4 text-sm text-muted">We couldn&apos;t reach the server. Try again.</p>
            <Button variant="secondary" onClick={retry}>Try again</Button>
        </Notice>
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
    if (active === 'events') {
        const Lead = mod?.eventsLead;
        // ROK-2185: the past-events route answers members and staff (staff resolve to leader); a visitor gets 403.
        const past = { guildId: page.guild.id, canPage: page.viewer.role !== 'visitor' };
        return <HubEventsTab query={ctx.raids} kind={page.guild.kind} lead={Lead && <Lead {...ctx} />} past={past} />;
    }
    if (active === 'posts') {
        return (
            <Suspense fallback={<div className="h-28 animate-pulse rounded-lg border border-edge bg-panel" aria-busy="true" />}>
                <HubPostsTab guildId={page.guild.id} canEdit={page.viewer.canEdit} isLeader={page.viewer.role === 'leader'} kind={page.guild.kind} />
            </Suspense>
        );
    }
    if (active === 'resources') return <GuildResources guildId={page.guild.id} canEdit={page.viewer.canEdit} module={mod} kind={page.guild.kind} />;
    const tab = hubModuleTabs(mod).find((t) => t.id === active);
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
            {overlay === 'picker' && <HubDiscordPickerMount guildId={ctx.page.guild.id} kind={ctx.page.guild.kind} onClose={onClose} />}
        </Suspense>
    );
}

/** The sheet, the picker it opens, and the hero trigger that starts both (ROK-1830 S4). */
function useHubSettingsState(canManage: boolean, canPick: boolean) {
    const [requested, setRequested] = useState<HubOverlay>('closed');
    const openPicker = useCallback(() => setRequested('picker'), []);
    const openSettings = useCallback(() => setRequested('settings'), []);
    const onClose = useCallback(() => setRequested('closed'), []);
    // Both overlays are Leader-only, so the rights gate the RENDER rather than
    // an effect that resets the state: a refetched page that demotes the viewer
    // mid-session takes the open dialog off the screen in the same commit, and
    // nothing cascades. (The stale request is harmless — a re-promoted viewer
    // reopens from the trigger.)
    const allowed = requested === 'picker' ? canPick : canManage;
    const overlay: HubOverlay = allowed ? requested : 'closed';
    const value: HubSettingsValue = useMemo(
        () => ({ openChannelPicker: canPick ? openPicker : null }), [canPick, openPicker]);
    return { overlay, openPicker, onClose, openSettings, value };
}

interface FrameProps {
    ctx: HubCtx;
    module: HubModule | undefined;
    showResources: boolean;
    /** ROK-1868 A5 — the Posts tab shows once the hub has a post, or for a `?post=` deep link. */
    hasPosts: boolean;
    mods: ModsState;
}

/** Hero + tab nav + panel. Rendered under `HubResourceVisibility`, so `showResources` is already settled. */
function HubFrame({ ctx, module: mod, showResources, hasPosts, mods }: FrameProps): JSX.Element {
    const tabs = hubTabs(mod, ctx, showResources, hasPosts);
    const [active] = useHashTab(visibleHubTabIds(tabs), 'overview', HUB_TAB_HASH_ALIASES);
    const canManage = canOpenHubSettings(ctx.page);
    const s = useHubSettingsState(canManage, canUseHubChannelPicker(ctx.page));
    return (
        <HubSettingsProvider value={s.value}>
            <div className={PAGE}>
                <HubHero ctx={ctx} module={mod} nextRaid={ctx.raids.data?.nextRaid ?? null}
                    action={canManage || hubBellVisible(ctx.page.viewer) ? (
                        <div className="flex items-center gap-2">
                            <HubNotifyBell page={ctx.page} />
                            {canManage && <HubSettingsTrigger onOpen={s.openSettings} label={hubCopy(ctx.page.guild.kind).settingsTitle} />}
                        </div>
                    ) : null} />
                <TabRow tabs={tabs} activeId={active} label={hubSectionsLabel(ctx.page.guild.kind)} className="mb-6" />
                <TabPanel active={active} ctx={ctx} module={mod} tabs={tabs} mods={mods} />
                <HubOverlays ctx={ctx} module={mod} overlay={s.overlay} onClose={s.onClose} openPicker={s.openPicker} />
                {/* ROK-2074: page-level (was the Overview's), so the hero crest opens it from every tab. */}
                <HubGalleryDialogMount guildId={ctx.page.guild.id} canEdit={ctx.page.viewer.canEdit} />
            </div>
        </HubSettingsProvider>
    );
}

function GuildPageBody({ page }: { page: GuildPageDto }): JSX.Element {
    const raids = useGuildRaids(page.guild.id);
    const mod = useHubModule(page.guild.kind);
    const profile = useGuildProfile(page.guild.id);
    // A `?post=` link resolves even when no post is left, so a deleted last post says so (AC3).
    const linkedPost = postIdFromSearch(useLocation().search);
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
                hasPosts={!!profile.data?.latestPost || linkedPost !== null}
                mods={{ hasSources: sources.length > 0, configured: anyVisible }} />}
        </HubResourceVisibility>
    );
}

type RecoveryLatch = { guildId: number; dataUpdatedAt: number; errorUpdatedAt: number };
type GuildPageQuery = ReturnType<typeof useGuildPage>;

/**
 * Whether the query moved past the latch: another hub, a success, or a newer
 * error that is NOT a 401 (a 403/404/5xx). A still-401 refetch — the
 * recovery's own, or a resume refresh's — and an in-flight refetch (which
 * clears an uncached query's `error`) keep the hold, so Sign in is final.
 */
function latchReleased(latch: RecoveryLatch, query: GuildPageQuery, guildId: number): boolean {
    if (latch.guildId !== guildId || latch.dataUpdatedAt !== query.dataUpdatedAt) return true;
    return query.error != null && query.errorUpdatedAt !== latch.errorUpdatedAt && httpStatusOf(query.error) !== 401;
}

/**
 * ROK-1947: the recovery refetch clears an uncached query's error, so the
 * re-check screen is held until it lands, or the next 401 would remount it
 * and loop. Once released (see {@link latchReleased}) the latch is dropped, so
 * a later in-flight refetch cannot revive a stale Sign in.
 */
function useRecoveryLatch(query: GuildPageQuery, guildId: number) {
    const [latch, setLatch] = useState<RecoveryLatch | null>(null);
    const released = latch !== null && latchReleased(latch, query, guildId);
    // Dropped during render (React's adjust-state-on-change pattern): the next pass has no latch.
    if (released) setLatch(null);
    const recovering = latch !== null && !released;
    const recoverPage = async () => {
        setLatch({ guildId, dataUpdatedAt: query.dataUpdatedAt, errorUpdatedAt: query.errorUpdatedAt });
        const result = await query.refetch({ cancelRefetch: false });
        if (result.status === 'success') setLatch(null);
        return result;
    };
    return { recovering, recoverPage };
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
    const moduleError = useHubModuleLoadError(query.data?.guild.kind);
    const { recovering, recoverPage } = useRecoveryLatch(query, guildId);
    if (!Number.isInteger(guildId) || guildId <= 0) {
        return <NotFoundNotice />;
    }
    const refetchPage = () => query.refetch({ cancelRefetch: false });
    if (recovering || httpStatusOf(query.error) === 401) return <SessionExpired onRecovered={recoverPage} />;
    // Cached data (a refetch error) still knows the kind; with none it falls back to WoW copy.
    if (query.error) return <ErrorState error={query.error} onRetry={refetchPage} kind={query.data?.guild.kind} guildId={guildId} />;
    if (moduleError) return <ErrorState error={moduleError} onRetry={retryHubModuleLoad} kind={query.data?.guild.kind} />;
    if (!query.data || !pluginsHydrated || modulePending) return <LoadingState />;
    return <GuildPageBody page={query.data} />;
}
