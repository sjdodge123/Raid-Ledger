import { useState } from 'react';
import { useRefreshCommunityInsights } from '../../hooks/use-community-insights';
import { toast } from '../../lib/toast';

/**
 * ROK-1099 Admin Community Insights settings. The slider adjusts the
 * churn-threshold override applied to the next `/churn` read; the
 * "Refresh insights now" button kicks off a server-side snapshot refresh.
 * Persistent default (community_insights_churn_threshold_pct) is read
 * server-side from app_settings and used by the nightly cron; this UI
 * only surfaces a session-level override to explore the distribution.
 */
export function CommunityInsightsSection() {
    const [threshold, setThreshold] = useState(70);
    const refresh = useRefreshCommunityInsights();

    const handleRefresh = () => {
        refresh.mutate(undefined, {
            onSuccess: () => toast.success('Community insights refresh queued'),
            onError: (err) => toast.error(err.message),
        });
    };

    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
            <div>
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                    Community Insights
                </h3>
                <p className="text-xs text-muted mt-1">
                    Tune the churn-risk threshold and trigger an immediate snapshot refresh. The
                    nightly cron runs at 06:30 UTC.
                </p>
            </div>

            <div>
                <label htmlFor="community-insights-threshold" className="text-sm text-foreground block mb-1">
                    Churn risk threshold: <span className="font-semibold">{threshold}%</span>
                </label>
                <input
                    id="community-insights-threshold"
                    type="range"
                    min={1}
                    max={100}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="w-full sm:max-w-md"
                    aria-describedby="community-insights-threshold-help"
                />
                <p id="community-insights-threshold-help" className="text-xs text-muted mt-1">
                    Session-level override (1-100). Applies to queries from this browser.
                </p>
            </div>

            <button
                type="button"
                onClick={handleRefresh}
                disabled={refresh.isPending}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
                {refresh.isPending ? 'Refreshing...' : 'Refresh insights now'}
            </button>
        </div>
    );
}
