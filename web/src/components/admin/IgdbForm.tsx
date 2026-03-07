import { useState } from 'react';
import { toast } from '../../lib/toast';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { PasswordInput, TestResultBanner, CopyableInput, FormTextField } from './admin-form-helpers';

/** Format ISO date as relative time (e.g., "5m ago") */
function formatRelativeTime(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function IgdbSetupInstructions() {
    return (
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 mb-6">
            <p className="text-sm text-foreground"><strong>Setup Instructions:</strong></p>
            <ol className="text-sm text-secondary mt-2 space-y-1 list-decimal list-inside">
                <li>Go to <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noopener noreferrer" className="underline hover:text-purple-300">Twitch Developer Console</a></li>
                <li>Register or select an application</li>
                <li>Copy the Client ID and generate a Client Secret</li>
                <li>These same credentials work for both IGDB and Twitch APIs</li>
            </ol>
        </div>
    );
}

function RedirectUriSection() {
    return (
        <div className="mb-6">
            <label className="block text-sm font-medium text-secondary mb-1.5">
                Redirect URI <span className="text-dim">(paste into Twitch Developer Console)</span>
            </label>
            <CopyableInput value="http://localhost" onCopied="Redirect URI copied!" />
            <p className="text-xs text-dim mt-1.5">
                Twitch requires a redirect URI when registering your app. IGDB uses client credentials, so this value isn't used — but it must be set.
            </p>
        </div>
    );
}

function useIgdbFormState() {
    const { igdbStatus, updateIgdb, testIgdb, clearIgdb, igdbSyncStatus, syncIgdb } = useAdminSettings();
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [showSecret, setShowSecret] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    return { igdbStatus, updateIgdb, testIgdb, clearIgdb, igdbSyncStatus, syncIgdb, clientId, setClientId, clientSecret, setClientSecret, showSecret, setShowSecret, testResult, setTestResult };
}

function useIgdbHandlers() {
    const s = useIgdbFormState();

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault(); s.setTestResult(null);
        if (!s.clientId || !s.clientSecret) { toast.error('Client ID and Client Secret are required'); return; }
        try {
            const r = await s.updateIgdb.mutateAsync({ clientId: s.clientId, clientSecret: s.clientSecret });
            if (r.success) { toast.success(r.message); s.setClientId(''); s.setClientSecret(''); } else toast.error(r.message);
        } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to save configuration'); }
    };

    const handleTest = async () => {
        s.setTestResult(null);
        try { const r = await s.testIgdb.mutateAsync(); s.setTestResult(r); if (r.success) toast.success(r.message); else toast.error(r.message); }
        catch { toast.error('Failed to test configuration'); }
    };

    const handleClear = async () => {
        if (!confirm('Are you sure you want to clear the IGDB configuration? Game discovery features will be disabled.')) return;
        try { const r = await s.clearIgdb.mutateAsync(); if (r.success) { toast.success(r.message); s.setTestResult(null); } else toast.error(r.message); }
        catch { toast.error('Failed to clear configuration'); }
    };

    return { ...s, handleSave, handleTest, handleClear,
        isPending: { save: s.updateIgdb.isPending, test: s.testIgdb.isPending, clear: s.clearIgdb.isPending } };
}

function IgdbActionButtons({ configured, isPending, onTest, onClear }: {
    configured: boolean; isPending: { save: boolean; test: boolean; clear: boolean };
    onTest: () => void; onClear: () => void;
}) {
    return (
        <div className="flex flex-wrap gap-3 pt-2">
            <button type="submit" disabled={isPending.save}
                className="flex-1 py-3 px-4 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors">
                {isPending.save ? 'Saving...' : 'Save Configuration'}
            </button>
            {configured && (
                <>
                    <button type="button" onClick={onTest} disabled={isPending.test}
                        className="py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors">
                        {isPending.test ? 'Testing...' : 'Test Connection'}
                    </button>
                    <button type="button" onClick={onClear} disabled={isPending.clear}
                        className="py-3 px-4 bg-red-600/20 hover:bg-red-600/30 text-red-400 font-semibold rounded-lg transition-colors border border-red-600/50">
                        Clear
                    </button>
                </>
            )}
        </div>
    );
}

function tokenStatusDotClass(status: string) {
    if (status === 'valid') return 'bg-emerald-400';
    if (status === 'expired') return 'bg-yellow-400';
    return 'bg-gray-400';
}

function tokenStatusLabel(status: string) {
    if (status === 'valid') return 'Valid';
    if (status === 'expired') return 'Expired';
    return 'Not fetched';
}

function HealthInfo({ health }: { health: { tokenStatus: string; tokenExpiresAt?: string | null; lastApiCallAt?: string | null; lastApiCallSuccess?: boolean } }) {
    return (
        <div className="flex flex-wrap gap-3 text-sm">
            <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${tokenStatusDotClass(health.tokenStatus)}`} />
                <span className="text-secondary">Token: {tokenStatusLabel(health.tokenStatus)}</span>
                {health.tokenStatus === 'valid' && health.tokenExpiresAt && (
                    <span className="text-dim">(expires {formatRelativeTime(health.tokenExpiresAt)})</span>
                )}
            </div>
            {health.lastApiCallAt && (
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${health.lastApiCallSuccess ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    <span className="text-secondary">Last API call: {formatRelativeTime(health.lastApiCallAt)}</span>
                </div>
            )}
        </div>
    );
}

const SyncSpinner = (
    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
);

function SyncStatusBar({ igdbSyncStatus, syncIgdb }: { igdbSyncStatus: ReturnType<typeof useAdminSettings>['igdbSyncStatus']; syncIgdb: ReturnType<typeof useAdminSettings>['syncIgdb'] }) {
    const isSyncing = syncIgdb.isPending || igdbSyncStatus.data?.syncInProgress;

    const handleSync = () => {
        syncIgdb.mutateAsync().then((r) => {
            toast[r.success ? 'success' : 'error'](r.message);
        }).catch(() => toast.error('Sync failed'));
    };

    return (
        <div className="flex items-center justify-between bg-surface/30 rounded-lg p-3">
            <div className="text-sm">
                <span className="text-secondary">
                    {igdbSyncStatus.data ? `${igdbSyncStatus.data.gameCount} games cached` : 'Loading...'}
                </span>
                {igdbSyncStatus.data?.lastSyncAt && (
                    <span className="text-dim ml-2">&middot; Last sync {formatRelativeTime(igdbSyncStatus.data.lastSyncAt)}</span>
                )}
            </div>
            <button type="button" onClick={handleSync} disabled={!!isSyncing}
                className="px-4 py-2.5 min-h-[44px] text-sm bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors flex items-center gap-2">
                {isSyncing && SyncSpinner}
                {syncIgdb.isPending ? 'Syncing...' : 'Sync Now'}
            </button>
        </div>
    );
}

export function IgdbForm() {
    const h = useIgdbHandlers();
    const placeholder = h.igdbStatus.data?.configured ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : undefined;

    return (
        <>
            <IgdbSetupInstructions />
            <RedirectUriSection />
            <form onSubmit={h.handleSave} className="space-y-4">
                <FormTextField id="igdbClientId" label="Client ID" value={h.clientId} onChange={h.setClientId}
                    placeholder={placeholder ?? 'Twitch Application Client ID'} ringColor="focus:ring-purple-500" />
                <div>
                    <label htmlFor="igdbClientSecret" className="block text-sm font-medium text-secondary mb-1.5">Client Secret</label>
                    <PasswordInput id="igdbClientSecret" value={h.clientSecret} onChange={h.setClientSecret}
                        placeholder={placeholder ?? 'Twitch Application Client Secret'}
                        showPassword={h.showSecret} onToggleShow={() => h.setShowSecret(!h.showSecret)} ringColor="focus:ring-purple-500" />
                </div>
                <TestResultBanner result={h.testResult} />
                <IgdbActionButtons configured={!!h.igdbStatus.data?.configured} isPending={h.isPending}
                    onTest={h.handleTest} onClear={h.handleClear} />
            </form>
            {h.igdbStatus.data?.configured && (
                <div className="mt-6 pt-6 border-t border-edge/50 space-y-4">
                    {h.igdbStatus.data.health && <HealthInfo health={h.igdbStatus.data.health} />}
                    <SyncStatusBar igdbSyncStatus={h.igdbSyncStatus} syncIgdb={h.syncIgdb} />
                </div>
            )}
        </>
    );
}
