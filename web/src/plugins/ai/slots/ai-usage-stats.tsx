import { useAiUsage } from '../../../hooks/admin/use-ai-settings';

/** Single stat card for usage dashboard. */
function StatCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-surface/50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted">{label}</p>
            <p className="text-lg font-semibold text-foreground">{value}</p>
        </div>
    );
}

/**
 * Mini dashboard showing AI usage statistics.
 * Displays request counts, average latency, error rate,
 * and per-feature breakdown.
 */
export function AiUsageStats() {
    const { data: usage, isLoading } = useAiUsage();

    if (isLoading) {
        return (
            <div className="animate-pulse space-y-2">
                <div className="h-16 bg-surface/50 rounded-lg" />
                <div className="h-16 bg-surface/50 rounded-lg" />
            </div>
        );
    }

    if (!usage) return null;

    return (
        <div className="space-y-3">
            <h3 className="text-sm font-medium text-secondary">Usage (30 days)</h3>
            <div className="grid grid-cols-3 gap-2">
                <StatCard label="Requests Today" value={String(usage.requestsToday)} />
                <StatCard label="Avg Latency" value={`${usage.avgLatencyMs}ms`} />
                <StatCard label="Err. Rate" value={`${(usage.errorRate * 100).toFixed(1)}%`} />
            </div>
            {usage.byFeature.length > 0 && (
                <FeatureBreakdown features={usage.byFeature} />
            )}
        </div>
    );
}

function FeatureBreakdown({ features }: { features: { feature: string; count: number; avgLatencyMs: number }[] }) {
    return (
        <table className="w-full text-sm">
            <thead>
                <tr className="text-muted text-xs">
                    <th className="text-left py-1">Feature</th>
                    <th className="text-right py-1">Requests</th>
                    <th className="text-right py-1">Avg Latency</th>
                </tr>
            </thead>
            <tbody>
                {features.map((f) => (
                    <tr key={f.feature} className="text-foreground">
                        <td className="py-1">{f.feature}</td>
                        <td className="text-right">{f.count}</td>
                        <td className="text-right">{f.avgLatencyMs}ms</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
