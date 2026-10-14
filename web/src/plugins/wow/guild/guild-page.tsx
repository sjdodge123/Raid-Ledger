/**
 * ROK-1785 (S1 of ROK-1781) — `/guilds/:id`: hero + `TabRow` + the active tab.
 * S1 shows Overview and Roster only; every other tab is hidden until its
 * story ships (spec Q3). A 403 (not a member) is a friendly empty state.
 */
import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { GuildPage as GuildPageDto } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { TabRow } from '../../../components/ui/tab-row';
import { tabPanelId, useHashTab } from '../../../components/ui/tab-row.helpers';
import { httpStatusOf } from '../../../lib/api/api-error';
import { GuildHero } from './guild-hero';
import { GuildOverview } from './guild-overview';
import { GUILD_TABS, VISIBLE_TAB_IDS, tabLabel } from './guild-roster.helpers';
import { GuildRoster } from './guild-roster';
import { useGuildPage } from './use-guild';

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

/** Scroll the panel top back into view when a tab switch happens below it (prototype `GuildTabPanel`). */
function TabPanel({ active, page }: { active: string; page: GuildPageDto }): JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
    }, [active]);
    return (
        <div ref={ref} id={tabPanelId('guild', active)} role="region" aria-label={tabLabel(active)} className="scroll-mt-4">
            {active === 'roster' ? <GuildRoster page={page} /> : <GuildOverview page={page} />}
        </div>
    );
}

function GuildPageBody({ page }: { page: GuildPageDto }): JSX.Element {
    const [active] = useHashTab(VISIBLE_TAB_IDS, 'overview');
    return (
        <div className={PAGE}>
            <GuildHero page={page} />
            <TabRow tabs={GUILD_TABS} activeId={active} label="Guild page sections" className="mb-6" />
            <TabPanel active={active} page={page} />
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
