import { useCommunityTemporal } from '../../../hooks/use-community-insights';
import { TemporalHeatmap } from './TemporalHeatmap';
import { PeakHoursChart } from './PeakHoursChart';
import { InsightsPanelShell } from './InsightsPanelShell';

/**
 * ROK-1099 Temporal section — 7x24 activity heatmap + weekday peak-hour
 * stacked bars. Carries the TDD `community-insights-temporal` testid.
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
                <div className="space-y-6">
                    <div>
                        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-2">
                            Weekly Activity Heatmap
                        </h3>
                        <TemporalHeatmap heatmap={q.data.heatmap} />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-2">
                            Peak Hours by Weekday
                        </h3>
                        <PeakHoursChart peakHours={q.data.peakHours} />
                    </div>
                </div>
            )}
        </InsightsPanelShell>
    );
}
