import type { CommunityRadarResponseDto } from '@raid-ledger/contract';
import { useCommunityRadar } from '../../../hooks/use-community-insights';
import { CommunityTasteRadar } from './CommunityTasteRadar';
import { ArchetypeDistribution } from './ArchetypeDistribution';
import { TasteDriftChart } from './TasteDriftChart';
import { InsightsPanelShell } from './InsightsPanelShell';

/**
 * ROK-1099 Community Taste Overview — aggregate radar + archetype
 * distribution + 8-week drift. Single section wrapper carries the TDD
 * `community-insights-radar` testid.
 */
export function CommunityTasteOverview() {
    const q = useCommunityRadar();
    return (
        <InsightsPanelShell
            testid="community-insights-radar"
            title="Community Taste Overview"
            status={q}
            emptyHint="Not enough taste data yet to render the community radar."
        >
            {q.data && <OverviewGrid data={q.data} />}
        </InsightsPanelShell>
    );
}

function OverviewGrid({ data }: { data: CommunityRadarResponseDto }) {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PanelBlock title="Aggregate Radar">
                <CommunityTasteRadar axes={data.axes} />
            </PanelBlock>
            <div className="space-y-6">
                <PanelBlock title="Archetype Distribution">
                    <ArchetypeDistribution archetypes={data.archetypes} />
                </PanelBlock>
                <PanelBlock title="8-week Taste Drift (top 3 axes)">
                    <TasteDriftChart driftSeries={data.driftSeries} />
                </PanelBlock>
            </div>
        </div>
    );
}

function PanelBlock({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-2">
                {title}
            </h3>
            {children}
        </div>
    );
}
