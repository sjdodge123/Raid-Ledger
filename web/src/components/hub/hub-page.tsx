/**
 * ROK-1785/ROK-1830 — `/guilds/:id`: the game-agnostic hub shell — hero +
 * `TabRow` + the active tab. Game-specific tabs, widgets, member columns and
 * hero pills come from the hub module registered for `guild.kind`
 * (`web/src/plugins/hub-module.ts`); core never imports a plugin.
 * Resources is core's own tab, shown once it has content or the viewer can
 * edit it. A 403 (not a member) is a friendly empty state.
 */
import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { GuildPage as GuildPageDto } from '@raid-ledger/contract';
import { Button } from '../ui/button';
import { TabRow } from '../ui/tab-row';
import { tabPanelId, useHashTab } from '../ui/tab-row.helpers';
import { httpStatusOf } from '../../lib/api/api-error';
import { type HubCtx, type HubModule, useHubModule } from '../../plugins/hub-module';
import { HubHero } from './hub-hero';
import { HubOverview } from './hub-overview';
import { resourcesVisible } from './content/guild-content.helpers';
import { GuildResources } from './content/guild-resources';
import { hubTabLabel, hubTabs, visibleHubTabIds, type HubTabEntry } from './hub-tabs';
import { HubMembers } from './hub-members';
import { useGuildPage, useGuildRaids } from './api/use-guild';
import { useGuildAddons, useGuildProfile } from './api/use-guild-content';

const PAGE = 'max-w-5xl mx-auto px-4 py-8';

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
}

function ActiveTab({ active, ctx, module: mod }: Omit<PanelProps, 'tabs'>): JSX.Element {
    const { page } = ctx;
    if (active === 'roster') return <HubMembers ctx={ctx} module={mod} />;
    if (active === 'resources') return <GuildResources guildId={page.guild.id} canEdit={page.viewer.canEdit} />;
    const tab = mod?.tabs.find((t) => t.id === active);
    if (tab) return <tab.component {...ctx} />;
    return <HubOverview ctx={ctx} module={mod} />;
}

/** Resources shows once it has content, or straight away for an editor. */
function useShowResources(page: GuildPageDto): boolean {
    const profile = useGuildProfile(page.guild.id);
    const addons = useGuildAddons(page.guild.id);
    return resourcesVisible(page.viewer.canEdit, profile.data, addons.data);
}

/** Scroll the panel top back into view when a tab switch happens below it (prototype `GuildTabPanel`). */
function TabPanel({ active, ctx, module: mod, tabs }: PanelProps): JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
    }, [active]);
    return (
        <div ref={ref} id={tabPanelId('guild', active)} role="region" aria-label={hubTabLabel(tabs, active)} className="scroll-mt-4">
            <ActiveTab active={active} ctx={ctx} module={mod} />
        </div>
    );
}

function GuildPageBody({ page }: { page: GuildPageDto }): JSX.Element {
    const showResources = useShowResources(page);
    const raids = useGuildRaids(page.guild.id);
    const mod = useHubModule(page.guild.kind);
    const ctx: HubCtx = { page, raids };
    const tabs = hubTabs(mod, ctx, showResources);
    const [active] = useHashTab(visibleHubTabIds(tabs), 'overview');
    return (
        <div className={PAGE}>
            <HubHero ctx={ctx} module={mod} nextRaid={raids.data?.nextRaid ?? null} />
            <TabRow tabs={tabs} activeId={active} label="Guild page sections" className="mb-6" />
            <TabPanel active={active} ctx={ctx} module={mod} tabs={tabs} />
        </div>
    );
}

export function GuildPage(): JSX.Element {
    const { id } = useParams<{ id: string }>();
    const guildId = Number(id);
    const query = useGuildPage(Number.isInteger(guildId) ? guildId : 0);
    if (!Number.isInteger(guildId) || guildId <= 0) {
        return <Notice testId="guild-not-found"><p className="text-sm text-muted">This guild doesn&apos;t exist. Check the link and try again.</p></Notice>;
    }
    if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
    if (!query.data) return <LoadingState />;
    return <GuildPageBody page={query.data} />;
}
