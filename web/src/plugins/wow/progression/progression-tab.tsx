/**
 * ROK-1789 Part B (B-4, ruling B1) — the WoW: Forever guild "Progression" tab:
 * per-instance sections on the left, the 30-day activity feed (`ActivityFeed`,
 * lane LB7) in a right column at ≥1024px and stacked below on a phone.
 * Loaded lazily by `hub/wow-tabs.tsx`, so this is the module's default export.
 */
import { useId, type JSX } from 'react';
import type { WowGuildProgressionPageDto } from '@raid-ledger/contract';
import type { HubCtx } from '../../hub-module';
import { RAID_PROGRESS_EMPTY_COPY } from '../hub-widgets/raid-progress.helpers';
import { ActivityFeed } from './activity-feed';
import { ProgressionInstance } from './progression-instance';
import { ProgressionSkeleton } from './progression-skeleton';
import { useGuildProgression } from './use-guild-progression';

function ProgressionLayout({ data }: { data: WowGuildProgressionPageDto }): JSX.Element {
    const { instances } = data.progression;
    const headingId = useId();
    return (
        <div data-testid="wow-progression-tab" className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
            <section aria-labelledby={headingId} data-testid="progression-instances">
                <h2 id={headingId} className="sr-only">Raid progression</h2>
                {instances.length === 0
                    ? <p data-testid="progression-empty" className="rounded-lg border border-edge bg-panel p-4 text-sm text-muted">{RAID_PROGRESS_EMPTY_COPY}</p>
                    : <ul className="flex flex-col gap-4">{instances.map((i) => <ProgressionInstance key={i.key} instance={i} />)}</ul>}
            </section>
            <aside aria-label="Activity feed" data-testid="progression-feed">
                <ActivityFeed activity={data.activity} />
            </aside>
        </div>
    );
}

/** The Progression tab body for one guild. */
export default function ProgressionTab({ page }: Pick<HubCtx, 'page'>): JSX.Element {
    const query = useGuildProgression(page.guild.id);
    if (query.isPending) return <ProgressionSkeleton />;
    if (query.isError) {
        return <p role="alert" className="rounded-lg border border-edge bg-panel p-4 text-sm text-danger">Couldn&apos;t load raid progression.</p>;
    }
    return <ProgressionLayout data={query.data} />;
}
