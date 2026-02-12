import { useState } from 'react';
import { toast } from '@/lib/toast';
import { useAdminSettings } from '../../hooks/use-admin-settings';

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

const EyeOffIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
);
const EyeIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
);
const CopyIcon = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);

export function IgdbForm() {
    const { igdbStatus, updateIgdb, testIgdb, clearIgdb, igdbSyncStatus, syncIgdb } = useAdminSettings();

    const [igdbClientId, setIgdbClientId] = useState('');
    const [igdbClientSecret, setIgdbClientSecret] = useState('');
    const [showIgdbSecret, setShowIgdbSecret] = useState(false);
    const [igdbTestResult, setIgdbTestResult] = useState<{ success: boolean; message: string } | null>(null);

    const handleIgdbSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setIgdbTestResult(null);

        if (!igdbClientId || !igdbClientSecret) {
            toast.error('Client ID and Client Secret are required');
            return;
        }

        try {
            const result = await updateIgdb.mutateAsync({
                clientId: igdbClientId,
                clientSecret: igdbClientSecret,
            });
            if (result.success) {
                toast.success(result.message);
                setIgdbClientId('');
                setIgdbClientSecret('');
            } else {
                toast.error(result.message);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to save configuration';
            toast.error(message);
        }
    };

    const handleIgdbTest = async () => {
        setIgdbTestResult(null);
        try {
            const result = await testIgdb.mutateAsync();
            setIgdbTestResult(result);
            if (result.success) toast.success(result.message);
            else toast.error(result.message);
        } catch {
            toast.error('Failed to test configuration');
        }
    };

    const handleIgdbClear = async () => {
        if (!confirm('Are you sure you want to clear the IGDB configuration? Game discovery features will be disabled.')) {
            return;
        }
        try {
            const result = await clearIgdb.mutateAsync();
            if (result.success) {
                toast.success(result.message);
                setIgdbTestResult(null);
            } else {
                toast.error(result.message);
            }
        } catch {
            toast.error('Failed to clear configuration');
        }
    };

    return (
        <>
            {/* Setup Instructions */}
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 mb-6">
                <p className="text-sm text-foreground">
                    <strong>Setup Instructions:</strong>
                </p>
                <ol className="text-sm text-secondary mt-2 space-y-1 list-decimal list-inside">
                    <li>Go to <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noopener noreferrer" className="underline hover:text-purple-300">Twitch Developer Console</a></li>
                    <li>Register or select an application</li>
                    <li>Copy the Client ID and generate a Client Secret</li>
                    <li>These same credentials work for both IGDB and Twitch APIs</li>
                </ol>
            </div>

            {/* Twitch Redirect URI */}
            <div className="mb-6">
                <label className="block text-sm font-medium text-secondary mb-1.5">
                    Redirect URI <span className="text-dim">(paste into Twitch Developer Console)</span>
                </label>
                <div
                    className="relative cursor-pointer group"
                    onClick={async () => {
                        try {
                            await navigator.clipboard.writeText('http://localhost');
                            toast.success('Redirect URI copied!');
                        } catch {
                            toast.error('Failed to copy');
                        }
                    }}
                >
                    <input
                        type="text"
                        value="http://localhost"
                        readOnly
                        className="w-full px-4 py-3 bg-surface/50 border border-edge rounded-lg text-foreground cursor-pointer select-all focus:outline-none group-hover:border-dim transition-all text-sm"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted group-hover:text-foreground transition-colors">
                        {CopyIcon}
                    </div>
                </div>
                <p className="text-xs text-dim mt-1.5">
                    Twitch requires a redirect URI when registering your app. IGDB uses client credentials, so this value isn't used — but it must be set.
                </p>
            </div>

            {/* Configuration Form */}
            <form onSubmit={handleIgdbSave} className="space-y-4">
                <div>
                    <label htmlFor="igdbClientId" className="block text-sm font-medium text-secondary mb-1.5">
                        Client ID
                    </label>
                    <input
                        id="igdbClientId"
                        type="text"
                        value={igdbClientId}
                        onChange={(e) => setIgdbClientId(e.target.value)}
                        placeholder={igdbStatus.data?.configured ? '••••••••••••••••••••' : 'Twitch Application Client ID'}
                        className="w-full px-4 py-3 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    />
                </div>

                <div>
                    <label htmlFor="igdbClientSecret" className="block text-sm font-medium text-secondary mb-1.5">
                        Client Secret
                    </label>
                    <div className="relative">
                        <input
                            id="igdbClientSecret"
                            type={showIgdbSecret ? 'text' : 'password'}
                            value={igdbClientSecret}
                            onChange={(e) => setIgdbClientSecret(e.target.value)}
                            placeholder={igdbStatus.data?.configured ? '••••••••••••••••••••' : 'Twitch Application Client Secret'}
                            className="w-full px-4 py-3 pr-12 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                        />
                        <button
                            type="button"
                            onClick={() => setShowIgdbSecret(!showIgdbSecret)}
                            aria-label={showIgdbSecret ? 'Hide password' : 'Show password'}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
                        >
                            {showIgdbSecret ? EyeOffIcon : EyeIcon}
                        </button>
                    </div>
                </div>

                {/* Test Result */}
                {igdbTestResult && (
                    <div className={`p-3 rounded-lg animate-[fadeIn_0.3s_ease-in] ${igdbTestResult.success
                        ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                        : 'bg-red-500/10 border border-red-500/30 text-red-400'
                        }`}>
                        {igdbTestResult.message}
                    </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-3 pt-2">
                    <button
                        type="submit"
                        disabled={updateIgdb.isPending}
                        className="flex-1 py-3 px-4 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors"
                    >
                        {updateIgdb.isPending ? 'Saving...' : 'Save Configuration'}
                    </button>

                    {igdbStatus.data?.configured && (
                        <>
                            <button
                                type="button"
                                onClick={handleIgdbTest}
                                disabled={testIgdb.isPending}
                                className="py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors"
                            >
                                {testIgdb.isPending ? 'Testing...' : 'Test Connection'}
                            </button>

                            <button
                                type="button"
                                onClick={handleIgdbClear}
                                disabled={clearIgdb.isPending}
                                className="py-3 px-4 bg-red-600/20 hover:bg-red-600/30 text-red-400 font-semibold rounded-lg transition-colors border border-red-600/50"
                            >
                                Clear
                            </button>
                        </>
                    )}
                </div>
            </form>

            {/* Sync Status & Health (only when configured) */}
            {igdbStatus.data?.configured && (
                <div className="mt-6 pt-6 border-t border-edge/50 space-y-4">
                    {/* Health Info */}
                    {igdbStatus.data.health && (
                        <div className="flex flex-wrap gap-3 text-sm">
                            <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${
                                    igdbStatus.data.health.tokenStatus === 'valid'
                                        ? 'bg-emerald-400'
                                        : igdbStatus.data.health.tokenStatus === 'expired'
                                            ? 'bg-yellow-400'
                                            : 'bg-gray-400'
                                }`} />
                                <span className="text-secondary">
                                    Token: {igdbStatus.data.health.tokenStatus === 'valid'
                                        ? 'Valid'
                                        : igdbStatus.data.health.tokenStatus === 'expired'
                                            ? 'Expired'
                                            : 'Not fetched'}
                                </span>
                                {igdbStatus.data.health.tokenStatus === 'valid' && igdbStatus.data.health.tokenExpiresAt && (
                                    <span className="text-dim">
                                        (expires {formatRelativeTime(igdbStatus.data.health.tokenExpiresAt)})
                                    </span>
                                )}
                            </div>
                            {igdbStatus.data.health.lastApiCallAt && (
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${
                                        igdbStatus.data.health.lastApiCallSuccess ? 'bg-emerald-400' : 'bg-red-400'
                                    }`} />
                                    <span className="text-secondary">
                                        Last API call: {formatRelativeTime(igdbStatus.data.health.lastApiCallAt)}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Sync Status */}
                    <div className="flex items-center justify-between bg-surface/30 rounded-lg p-3">
                        <div className="text-sm">
                            <span className="text-secondary">
                                {igdbSyncStatus.data
                                    ? `${igdbSyncStatus.data.gameCount} games cached`
                                    : 'Loading...'}
                            </span>
                            {igdbSyncStatus.data?.lastSyncAt && (
                                <span className="text-dim ml-2">
                                    · Last sync {formatRelativeTime(igdbSyncStatus.data.lastSyncAt)}
                                </span>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                syncIgdb.mutateAsync().then((result) => {
                                    if (result.success) {
                                        toast.success(result.message);
                                    } else {
                                        toast.error(result.message);
                                    }
                                }).catch(() => toast.error('Sync failed'));
                            }}
                            disabled={syncIgdb.isPending || igdbSyncStatus.data?.syncInProgress}
                            className="px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors flex items-center gap-2"
                        >
                            {(syncIgdb.isPending || igdbSyncStatus.data?.syncInProgress) && (
                                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                            )}
                            {syncIgdb.isPending ? 'Syncing...' : 'Sync Now'}
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
