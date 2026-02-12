import { toast } from '@/lib/toast';
import { useAdminSettings } from '../../hooks/use-admin-settings';

/**
 * Demo Data management card (ROK-193).
 * Allows admins to install or delete demo data at runtime.
 */
export function DemoDataCard() {
    const { demoDataStatus, installDemoData, clearDemoData } = useAdminSettings();

    const status = demoDataStatus.data;
    const hasDemoData = status && status.users > 0;
    const isOperating = installDemoData.isPending || clearDemoData.isPending;

    const handleInstall = async () => {
        if (!confirm('This will create demo users, events, and sample data for testing. Continue?')) {
            return;
        }

        try {
            const result = await installDemoData.mutateAsync();
            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.message);
            }
        } catch {
            toast.error('Failed to install demo data');
        }
    };

    const handleClear = async () => {
        if (!status) return;

        const warning = [
            `This will permanently delete:`,
            `- ${status.users} demo users`,
            `- ${status.events} events`,
            `- ${status.characters} characters`,
            `- ${status.signups} signups`,
            `- ${status.availability} availability records`,
            `- ${status.gameTimeSlots} game time slots`,
            `- ${status.notifications} notifications`,
            ``,
            `Your admin account and game library will not be affected.`,
            `Continue?`,
        ].join('\n');

        if (!confirm(warning)) {
            return;
        }

        try {
            const result = await clearDemoData.mutateAsync();
            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.message);
            }
        } catch {
            toast.error('Failed to delete demo data');
        }
    };

    // Loading spinner SVG
    const Spinner = (
        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
    );

    return (
        <div className="mt-6">
            <div className="bg-panel/50 backdrop-blur-sm rounded-xl border border-edge/50 overflow-hidden">
                {/* Header */}
                <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-amber-600 flex items-center justify-center">
                            <svg className="w-6 h-6 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                            </svg>
                        </div>
                        <div className="text-left">
                            <h2 className="text-lg font-semibold text-foreground">Demo Data</h2>
                            <p className="text-sm text-muted">
                                {demoDataStatus.isLoading
                                    ? 'Loading...'
                                    : hasDemoData
                                        ? 'Sample data is installed'
                                        : 'No demo data installed'}
                            </p>
                        </div>
                    </div>

                    {/* Status Badge */}
                    <div
                        className={`px-3 py-1 rounded-full text-sm font-medium ${hasDemoData
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-overlay text-muted'
                            }`}
                    >
                        {demoDataStatus.isLoading
                            ? 'Loading...'
                            : hasDemoData
                                ? 'Installed'
                                : 'Empty'}
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 pt-2 border-t border-edge/50">
                    {demoDataStatus.isLoading ? (
                        <div className="flex items-center justify-center py-4">
                            {Spinner}
                            <span className="ml-2 text-muted">Loading status...</span>
                        </div>
                    ) : hasDemoData ? (
                        <>
                            {/* Entity Count Grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                                <CountBadge label="Users" count={status.users} />
                                <CountBadge label="Events" count={status.events} />
                                <CountBadge label="Characters" count={status.characters} />
                                <CountBadge label="Signups" count={status.signups} />
                                <CountBadge label="Availability" count={status.availability} />
                                <CountBadge label="Game Time" count={status.gameTimeSlots} />
                                <CountBadge label="Notifications" count={status.notifications} />
                            </div>

                            {/* Delete Button */}
                            <button
                                onClick={handleClear}
                                disabled={isOperating}
                                className="w-full py-3 px-4 bg-red-600/20 hover:bg-red-600/30 disabled:bg-red-800/20 disabled:cursor-not-allowed text-red-400 font-semibold rounded-lg transition-colors border border-red-600/50 flex items-center justify-center gap-2"
                            >
                                {clearDemoData.isPending && Spinner}
                                {clearDemoData.isPending ? 'Deleting...' : 'Delete All Demo Data'}
                            </button>
                        </>
                    ) : (
                        <>
                            <p className="text-sm text-secondary mb-4">
                                Install sample users, events, characters, and other data to explore the app. Your admin account and game library will not be affected.
                            </p>

                            {/* Install Button */}
                            <button
                                onClick={handleInstall}
                                disabled={isOperating}
                                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                                {installDemoData.isPending && Spinner}
                                {installDemoData.isPending ? 'Installing...' : 'Install Demo Data'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function CountBadge({ label, count }: { label: string; count: number }) {
    return (
        <div className="bg-surface/30 rounded-lg p-2.5 text-center">
            <div className="text-lg font-bold text-foreground">{count}</div>
            <div className="text-xs text-muted">{label}</div>
        </div>
    );
}
