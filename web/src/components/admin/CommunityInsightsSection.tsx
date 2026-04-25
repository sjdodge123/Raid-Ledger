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
            <SectionHeader />
            <ThresholdSlider threshold={threshold} onChange={setThreshold} />
            <RefreshButton onClick={handleRefresh} pending={refresh.isPending} />
        </div>
    );
}

function SectionHeader() {
    return (
        <div>
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                Community Insights
            </h3>
            <p className="text-xs text-muted mt-1">
                The Insights dashboard aggregates 6 community-wide views — taste profile,
                engagement health, churn risk, social graph, temporal patterns, and rule-based
                key insights — from a daily snapshot. The snapshot rebuilds nightly at 06:30 UTC.
            </p>
        </div>
    );
}

function ThresholdSlider({ threshold, onChange }: { threshold: number; onChange: (v: number) => void }) {
    return (
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
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-full sm:max-w-md"
                aria-describedby="community-insights-threshold-help"
            />
            <div id="community-insights-threshold-help" className="text-xs text-muted mt-2 space-y-1">
                <p>
                    A player is flagged "at risk" when their <strong className="text-secondary">recent
                    activity</strong> (last 4 weeks) drops by at least <strong className="text-secondary">{threshold}%</strong>
                    {' '}vs their <strong className="text-secondary">baseline</strong> (prior 12 weeks).
                </p>
                <p>
                    Lower threshold → more candidates flagged. Higher threshold → only the most extreme drop-offs.
                </p>
                <p className="italic">
                    This slider is a preview override — it changes only your current browser session.
                    The persistent default (70%) drives the nightly snapshot and lives in app settings.
                </p>
            </div>
        </div>
    );
}

function RefreshButton({ onClick, pending }: { onClick: () => void; pending: boolean }) {
    return (
        <div>
            <button
                type="button"
                onClick={onClick}
                disabled={pending}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
                {pending ? 'Refreshing...' : 'Refresh insights now'}
            </button>
            <p className="text-xs text-muted mt-2">
                Recomputes all 6 sections of today's snapshot from current player data. Useful
                after seeding test data or when a metric appears stale before the nightly cron runs.
            </p>
        </div>
    );
}
