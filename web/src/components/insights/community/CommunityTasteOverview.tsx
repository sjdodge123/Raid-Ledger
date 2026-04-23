/**
 * ROK-1099 Community Taste Overview section — aggregate radar, archetype
 * distribution, and 8-week drift. Real implementation in C3.
 */
export function CommunityTasteOverview() {
    return (
        <section
            data-testid="community-insights-radar"
            className="bg-panel/50 rounded-xl border border-edge/50 p-6"
        >
            <h2 className="text-xl font-semibold text-foreground mb-4">Community Taste Overview</h2>
            <p className="text-sm text-muted">Aggregate radar, archetype distribution, and 8-week drift load here.</p>
        </section>
    );
}
