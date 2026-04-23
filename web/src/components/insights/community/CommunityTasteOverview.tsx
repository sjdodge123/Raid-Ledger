import { useCommunityRadar, isNoSnapshotYet } from '../../../hooks/use-community-insights';
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
            {q.data && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div>
                        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-2">
                            Aggregate Radar
                        </h3>
                        <CommunityTasteRadar axes={q.data.axes} />
                    </div>
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-2">
                                Archetype Distribution
                            </h3>
                            <ArchetypeDistribution archetypes={q.data.archetypes} />
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-2">
                                8-week Taste Drift (top 3 axes)
                            </h3>
                            <TasteDriftChart driftSeries={q.data.driftSeries} />
                        </div>
                    </div>
                </div>
            )}
            {q.isError && isNoSnapshotYet(q.error) && <NoSnapshotEmpty />}
        </InsightsPanelShell>
    );
}

function NoSnapshotEmpty() {
    return (
        <p className="text-sm text-muted">
            No community snapshot has been computed yet. Run a refresh from the admin
            settings to populate this view.
        </p>
    );
}
