import { lazy, Suspense, useState } from 'react';
import { useCommunitySocialGraph, isNoSnapshotYet } from '../../../hooks/use-community-insights';
import { SocialGraphFallbackTable } from './SocialGraphFallbackTable';
import { CliquesPanel } from './CliquesPanel';
import { TasteLeadersPanel } from './TasteLeadersPanel';
import { InsightsPanelShell } from './InsightsPanelShell';

const SocialGraphCanvas = lazy(() =>
    import('./SocialGraphCanvas').then((m) => ({ default: m.SocialGraphCanvas })),
);

/**
 * ROK-1099 Social Graph container — toggles between a force-directed
 * canvas (lazy-loaded to avoid paying the three.js cost up front) and an
 * accessible `<table>` fallback. Carries the TDD
 * `community-insights-social-graph` testid on the outer section.
 */
export function SocialGraph() {
    const [showTable, setShowTable] = useState(false);
    const q = useCommunitySocialGraph({ limit: 60 });

    const actions = (
        <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
            className="px-3 py-1.5 text-sm font-medium bg-surface/50 hover:bg-surface border border-edge rounded-md text-foreground transition-colors"
        >
            {showTable ? 'Show as graph' : 'Show as table'}
        </button>
    );

    return (
        <InsightsPanelShell
            testid="community-insights-social-graph"
            title="Community Social Graph"
            status={q}
            emptyHint="No social graph yet — run a refresh to compute."
            actions={actions}
        >
            {q.data && !isNoSnapshotYet(q.error) && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2">
                        {showTable ? (
                            <SocialGraphFallbackTable data={q.data} />
                        ) : (
                            <Suspense fallback={<CanvasSkeleton />}>
                                <SocialGraphCanvas data={q.data} />
                            </Suspense>
                        )}
                    </div>
                    <div className="space-y-6">
                        <CliquesPanel cliques={q.data.cliques} nodes={q.data.nodes} />
                        <TasteLeadersPanel leaders={q.data.tasteLeaders} />
                    </div>
                </div>
            )}
        </InsightsPanelShell>
    );
}

function CanvasSkeleton() {
    return <div className="h-80 bg-overlay/30 rounded-lg animate-pulse" />;
}
