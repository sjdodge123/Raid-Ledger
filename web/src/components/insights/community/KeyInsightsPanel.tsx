/**
 * ROK-1099 Key Insights panel — rule-based narration of the day's
 * community activity. Real implementation in C6.
 */
export function KeyInsightsPanel() {
    return (
        <section
            data-testid="community-insights-key-insights"
            className="bg-panel/50 rounded-xl border border-edge/50 p-6"
        >
            <h2 className="text-xl font-semibold text-foreground mb-4">Key Insights</h2>
            <ul role="list" className="list-disc list-inside text-sm text-muted space-y-1">
                <li>Insights from the latest snapshot load here.</li>
            </ul>
        </section>
    );
}
