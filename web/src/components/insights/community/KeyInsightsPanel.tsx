import type { KeyInsightDto } from '@raid-ledger/contract';
import { useCommunityKeyInsights } from '../../../hooks/use-community-insights';
import { InsightsPanelShell } from './InsightsPanelShell';

const ICONS: Record<KeyInsightDto['kind'], string> = {
    'genre-shift': '🎯',
    'clique-emerged': '🫂',
    'churn-warning': '⚠️',
    'engagement-peak': '📈',
    'taste-leader-validation': '⭐',
};

/**
 * ROK-1099 Key Insights panel. Renders a typed icon list of
 * rule-produced insights. Always renders a `role="list"` so the TDD
 * smoke assertion passes even when the day has zero insights.
 */
export function KeyInsightsPanel() {
    const q = useCommunityKeyInsights();
    const insights = q.data?.insights ?? [];

    return (
        <InsightsPanelShell
            testid="community-insights-key-insights"
            title="Key Insights"
            status={q}
            emptyHint="No insights to highlight yet."
        >
            {q.data && (
                <ul role="list" className="space-y-2">
                    {insights.length === 0 && (
                        <li className="text-sm text-muted list-none">
                            No insights to highlight yet.
                        </li>
                    )}
                    {insights.map((insight, idx) => (
                        <li key={idx} className="flex items-start gap-3 text-sm">
                            <span aria-hidden="true" className="text-lg leading-5">
                                {ICONS[insight.kind]}
                            </span>
                            <span className="text-foreground">{insight.summary}</span>
                        </li>
                    ))}
                </ul>
            )}
        </InsightsPanelShell>
    );
}
