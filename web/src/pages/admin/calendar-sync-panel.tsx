import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import type { AdminCalendarSyncSettings } from '@raid-ledger/contract';
import { IntegrationCard } from '../../components/admin/IntegrationCard';
import { CalendarSyncForm } from '../../components/admin/CalendarSyncForm';
import { useAdminCalendarSyncSettings } from '../../hooks/use-admin-calendar-sync';

const CalendarIconTile = (
    <div className="w-10 h-10 rounded-lg bg-overlay flex items-center justify-center">
        <CalendarDaysIcon className="w-6 h-6 text-foreground" aria-hidden="true" />
    </div>
);

function PanelBody({ settings, isError }: { settings: AdminCalendarSyncSettings | undefined; isError: boolean }) {
    if (settings) return <CalendarSyncForm settings={settings} />;
    return <p className="text-sm text-muted">{isError ? 'Failed to load Calendar Sync settings.' : 'Loading…'}</p>;
}

/**
 * Integrations > Calendar Sync panel (ROK-1591): the admin kill switch plus
 * the Google / Microsoft OAuth client config members' calendar connections use.
 */
export function CalendarSyncPanel() {
    const { data, isLoading, isError } = useAdminCalendarSyncSettings();
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Calendar Sync</h2>
                <p className="text-sm text-muted mt-1">Let members sync events with their Google, Outlook or Apple calendars.</p>
            </div>
            <IntegrationCard
                title="Calendar Sync"
                description="Two-way sync between events and members' calendars"
                icon={CalendarIconTile}
                isConfigured={data?.enabled ?? false}
                isLoading={isLoading}
            >
                <PanelBody settings={data} isError={isError} />
            </IntegrationCard>
        </div>
    );
}
