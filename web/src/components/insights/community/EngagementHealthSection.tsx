import { useCommunityEngagement, useCommunityChurn, isNoSnapshotYet } from '../../../hooks/use-community-insights';
import { EngagementTrendChart } from './EngagementTrendChart';
import { IntensityHistogram } from './IntensityHistogram';
import { ChurnRiskTable } from './ChurnRiskTable';
import { InsightsPanelShell } from './InsightsPanelShell';

/**
 * ROK-1099 Engagement Health section — 12-week WAU trend, intensity
 * histogram, and churn-risk table. Carries the TDD
 * `community-insights-engagement` testid on its outer section.
 */
export function EngagementHealthSection() {
    const engagement = useCommunityEngagement();
    const churn = useCommunityChurn();

    const status = {
        isLoading: engagement.isLoading && churn.isLoading,
        isError: engagement.isError && churn.isError,
        error: engagement.error ?? churn.error ?? null,
        data: engagement.data ?? churn.data ?? null,
    };

    return (
        <InsightsPanelShell
            testid="community-insights-engagement"
            title="Engagement Health"
            status={status}
            emptyHint="No engagement snapshot has been computed yet. Run a refresh from admin settings."
        >
            {engagement.data && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    <div>
                        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-2">
                            12-week Weekly Active Users
                        </h3>
                        <EngagementTrendChart weeklyActiveUsers={engagement.data.weeklyActiveUsers} />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-2">
                            Weekly Intensity Distribution
                        </h3>
                        <IntensityHistogram buckets={engagement.data.intensityHistogram} />
                    </div>
                </div>
            )}
            {churn.data && !isNoSnapshotYet(churn.error) && (
                <div>
                    <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-2">
                        Churn Risk
                    </h3>
                    <ChurnRiskTable
                        thresholdPct={churn.data.thresholdPct}
                        atRisk={churn.data.atRisk}
                        notEnoughHistory={churn.data.notEnoughHistory}
                    />
                </div>
            )}
        </InsightsPanelShell>
    );
}
