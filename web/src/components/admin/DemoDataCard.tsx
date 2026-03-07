import { toast } from '../../lib/toast';
import { useAdminSettings } from '../../hooks/use-admin-settings';

const Spinner = (
    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
);

function CountBadge({ label, count }: { label: string; count: number }) {
    return (
        <div className="bg-surface/30 rounded-lg p-2.5 text-center">
            <div className="text-lg font-bold text-foreground">{count}</div>
            <div className="text-xs text-muted">{label}</div>
        </div>
    );
}

function DemoDataHeader({ isLoading, hasDemoData }: { isLoading: boolean; hasDemoData: boolean }) {
    const statusText = isLoading ? 'Loading...' : hasDemoData ? 'Sample data is installed' : 'No demo data installed';
    const badgeText = isLoading ? 'Loading...' : hasDemoData ? 'Installed' : 'Empty';
    const badgeClass = hasDemoData ? 'bg-amber-500/20 text-amber-400' : 'bg-overlay text-muted';
    return (
        <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-600 flex items-center justify-center">
                    <svg className="w-6 h-6 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                </div>
                <div className="text-left">
                    <h2 className="text-lg font-semibold text-foreground">Demo Data</h2>
                    <p className="text-sm text-muted">{statusText}</p>
                </div>
            </div>
            <div className={`px-3 py-1 rounded-full text-sm font-medium ${badgeClass}`}>{badgeText}</div>
        </div>
    );
}

interface DemoStatus { users: number; events: number; characters: number; signups: number; availability: number; gameTimeSlots: number; notifications: number }

function InstalledContent({ status, onClear, isClearing, isOperating }: {
    status: DemoStatus; onClear: () => void; isClearing: boolean; isOperating: boolean;
}) {
    return (
        <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <CountBadge label="Users" count={status.users} />
                <CountBadge label="Events" count={status.events} />
                <CountBadge label="Characters" count={status.characters} />
                <CountBadge label="Signups" count={status.signups} />
                <CountBadge label="Availability" count={status.availability} />
                <CountBadge label="Game Time" count={status.gameTimeSlots} />
                <CountBadge label="Notifications" count={status.notifications} />
            </div>
            <button onClick={onClear} disabled={isOperating}
                className="w-full py-3 px-4 bg-red-600/20 hover:bg-red-600/30 disabled:bg-red-800/20 disabled:cursor-not-allowed text-red-400 font-semibold rounded-lg transition-colors border border-red-600/50 flex items-center justify-center gap-2">
                {isClearing && Spinner}{isClearing ? 'Deleting...' : 'Delete All Demo Data'}
            </button>
        </>
    );
}

function EmptyContent({ onInstall, isInstalling, isOperating }: { onInstall: () => void; isInstalling: boolean; isOperating: boolean }) {
    return (
        <>
            <p className="text-sm text-secondary mb-4">Install sample users, events, characters, and other data to explore the app. Your admin account and game library will not be affected.</p>
            <button onClick={onInstall} disabled={isOperating}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors flex items-center justify-center gap-2">
                {isInstalling && Spinner}{isInstalling ? 'Installing...' : 'Install Demo Data'}
            </button>
        </>
    );
}

function buildClearWarning(status: DemoStatus) {
    return [
        `This will permanently delete:`,
        `- ${status.users} demo users`, `- ${status.events} events`, `- ${status.characters} characters`,
        `- ${status.signups} signups`, `- ${status.availability} availability records`,
        `- ${status.gameTimeSlots} game time slots`, `- ${status.notifications} notifications`,
        ``, `Your admin account and game library will not be affected.`, `Continue?`,
    ].join('\n');
}

/**
 * Demo Data management card (ROK-193).
 * Allows admins to install or delete demo data at runtime.
 */
function useDemoHandlers() {
    const { demoDataStatus, installDemoData, clearDemoData } = useAdminSettings();
    const status = demoDataStatus.data;

    const handleInstall = async () => {
        if (!confirm('This will create demo users, events, and sample data for testing. Continue?')) return;
        try { const r = await installDemoData.mutateAsync(); r.success ? toast.success(r.message) : toast.error(r.message); }
        catch { toast.error('Failed to install demo data'); }
    };

    const handleClear = async () => {
        if (!status || !confirm(buildClearWarning(status))) return;
        try { const r = await clearDemoData.mutateAsync(); r.success ? toast.success(r.message) : toast.error(r.message); }
        catch { toast.error('Failed to delete demo data'); }
    };

    return { demoDataStatus, status, installDemoData, clearDemoData, handleInstall, handleClear };
}

/**
 * Demo Data management card (ROK-193).
 */
export function DemoDataCard() {
    const h = useDemoHandlers();
    const hasDemoData = h.status && h.status.users > 0;
    const isOperating = h.installDemoData.isPending || h.clearDemoData.isPending;

    return (
        <div className="mt-6">
            <div className="bg-panel/50 backdrop-blur-sm rounded-xl border border-edge/50 overflow-hidden">
                <DemoDataHeader isLoading={h.demoDataStatus.isLoading} hasDemoData={!!hasDemoData} />
                <div className="p-6 pt-2 border-t border-edge/50">
                    {h.demoDataStatus.isLoading ? (
                        <div className="flex items-center justify-center py-4">{Spinner}<span className="ml-2 text-muted">Loading status...</span></div>
                    ) : hasDemoData ? (
                        <InstalledContent status={h.status!} onClear={h.handleClear} isClearing={h.clearDemoData.isPending} isOperating={isOperating} />
                    ) : (
                        <EmptyContent onInstall={h.handleInstall} isInstalling={h.installDemoData.isPending} isOperating={isOperating} />
                    )}
                </div>
            </div>
        </div>
    );
}
