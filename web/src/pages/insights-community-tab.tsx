import { CommunityTasteOverview } from '../components/insights/community/CommunityTasteOverview';
import { EngagementHealthSection } from '../components/insights/community/EngagementHealthSection';
import { SocialGraph } from '../components/insights/community/SocialGraph';
import { TemporalSection } from '../components/insights/community/TemporalSection';
import { KeyInsightsPanel } from '../components/insights/community/KeyInsightsPanel';

/**
 * ROK-1099 Community tab — grid of 5 panels surfaced by
 * /api/insights/community/*. All panels render their own empty/error/loading
 * states and the "Run refresh now" empty-state for 503 no_snapshot_yet.
 */
export function InsightsCommunityTab() {
    return (
        <div className="space-y-8">
            <CommunityTasteOverview />
            <EngagementHealthSection />
            <SocialGraph />
            <TemporalSection />
            <KeyInsightsPanel />
        </div>
    );
}
