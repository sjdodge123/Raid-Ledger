import { useState } from 'react';

/**
 * ROK-1099 Social Graph container. Real canvas + fallback table in C5.
 */
export function SocialGraph() {
    const [showTable, setShowTable] = useState(false);
    return (
        <section
            data-testid="community-insights-social-graph"
            className="bg-panel/50 rounded-xl border border-edge/50 p-6"
        >
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-foreground">Community Social Graph</h2>
                <button
                    type="button"
                    onClick={() => setShowTable((v) => !v)}
                    className="px-3 py-1.5 text-sm font-medium bg-surface/50 hover:bg-surface border border-edge rounded-md text-foreground transition-colors"
                >
                    {showTable ? 'Show as graph' : 'Show as table'}
                </button>
            </div>
            <p className="text-sm text-muted">Force-directed co-play graph loads here.</p>
        </section>
    );
}
