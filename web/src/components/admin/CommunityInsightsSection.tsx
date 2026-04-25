import { useEffect, useRef, useState } from 'react';
import { useCommunityInsightsSettings } from '../../hooks/admin/use-community-insights-settings';
import { useRefreshCommunityInsights } from '../../hooks/use-community-insights';
import { toast } from '../../lib/toast';

const SAVE_DEBOUNCE_MS = 500;

/**
 * ROK-1099 Admin Community Insights settings.
 *
 * The slider edits the persistent `community_insights.churn_threshold_pct`
 * setting consumed by the nightly snapshot cron. Slider changes are
 * debounced (500ms) and saved server-side; the next snapshot — manual or
 * the 06:30 UTC cron — uses the new value.
 */
export function CommunityInsightsSection() {
    const { settings, updateSettings } = useCommunityInsightsSettings();
    const refresh = useRefreshCommunityInsights();
    const [threshold, setThreshold] = useState(70);
    const dirty = useRef(false);
    const saveTimer = useRef<number | null>(null);

    // Hydrate slider from server once settings load.
    useEffect(() => {
        if (!dirty.current && settings.data) setThreshold(settings.data.churnThresholdPct);
    }, [settings.data]);

    const handleSliderChange = (next: number) => {
        dirty.current = true;
        setThreshold(next);
        if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
            updateSettings.mutate(
                { churnThresholdPct: next },
                {
                    onSuccess: () => {
                        dirty.current = false;
                        toast.success(`Churn threshold saved → ${next}%`);
                    },
                    onError: (err) => toast.error(err.message),
                },
            );
        }, SAVE_DEBOUNCE_MS);
    };

    const handleRefresh = () => {
        refresh.mutate(undefined, {
            onSuccess: () => toast.success('Community insights refresh queued'),
            onError: (err) => toast.error(err.message),
        });
    };

    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
            <SectionHeader />
            <ThresholdSlider
                threshold={threshold}
                onChange={handleSliderChange}
                saving={updateSettings.isPending}
                disabled={settings.isLoading}
            />
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

function ThresholdSlider({
    threshold,
    onChange,
    saving,
    disabled,
}: {
    threshold: number;
    onChange: (v: number) => void;
    saving: boolean;
    disabled: boolean;
}) {
    return (
        <div>
            <label htmlFor="community-insights-threshold" className="text-sm text-foreground block mb-1">
                Churn risk threshold: <span className="font-semibold">{threshold}%</span>
                {saving && <span className="ml-2 text-xs text-muted italic">saving…</span>}
            </label>
            <input
                id="community-insights-threshold"
                type="range"
                min={1}
                max={100}
                value={threshold}
                disabled={disabled}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-full sm:max-w-md disabled:opacity-50"
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
                <p>
                    The new value applies to the <em>next snapshot</em>. Press <strong className="text-secondary">"Refresh insights now"</strong>
                    {' '}below to regenerate immediately, or wait for the 06:30 UTC nightly cron.
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
                after changing the churn threshold, seeding test data, or whenever a metric
                appears stale before the nightly cron runs.
            </p>
        </div>
    );
}
