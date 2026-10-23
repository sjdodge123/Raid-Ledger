import { useCommunityTemporal } from '../../../hooks/use-community-insights';
import { TemporalHeatmap } from './TemporalHeatmap';
import { InsightsPanelShell } from './InsightsPanelShell';

/**
 * ROK-1099 Temporal section — 7x24 activity heatmap with each weekday's
 * peak hours ringed on the cells (ROK-1936; the separate peak-hours chart
 * is gone). Names the snapshot's timezone; a pre-ROK-1936 snapshot with no
 * `timezone` field omits the line. Carries the TDD
 * `community-insights-temporal` testid.
 */
export function TemporalSection() {
    const q = useCommunityTemporal();
    return (
        <InsightsPanelShell
            testid="community-insights-temporal"
            title="When the Community Plays"
            status={q}
            emptyHint="No temporal snapshot yet — run a refresh to compute."
        >
            {q.data && (
                <div>
                    <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-1">
                        Weekly Activity Heatmap
                    </h3>
                    <p className="text-xs text-muted mb-2">
                        Outlined cells are each day&apos;s peak hours.
                        {q.data.timezone && <span> Times in {q.data.timezone}</span>}
                    </p>
                    <TemporalHeatmap heatmap={q.data.heatmap} peakHours={q.data.peakHours} />
                </div>
            )}
        </InsightsPanelShell>
    );
}
