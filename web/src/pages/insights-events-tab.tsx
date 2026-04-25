import { MyEventsPage } from './my-events-page';

/**
 * ROK-1099 Events tab — re-renders the existing MyEventsPage body so members
 * keep their personal dashboard and admins keep the Dashboard/Analytics tabs.
 * No new UI here; the hub shell is provided by InsightsHubPage.
 */
export function InsightsEventsTab() {
    return <MyEventsPage />;
}
