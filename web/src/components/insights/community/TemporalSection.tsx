/**
 * ROK-1099 Temporal section — 7x24 activity heatmap + peak hours chart.
 * Real implementation in C6.
 */
export function TemporalSection() {
    return (
        <section
            data-testid="community-insights-temporal"
            className="bg-panel/50 rounded-xl border border-edge/50 p-6"
        >
            <h2 className="text-xl font-semibold text-foreground mb-4">When the Community Plays</h2>
            <p className="text-sm text-muted">Weekly activity heatmap and peak-hour distribution load here.</p>
        </section>
    );
}
