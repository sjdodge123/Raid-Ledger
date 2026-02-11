import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { useAdminSettings } from '../hooks/use-admin-settings';
import { IntegrationCard } from '../components/admin/IntegrationCard';
import { API_BASE_URL } from '../lib/config';
import { GameLibraryTable } from '../components/admin/GameLibraryTable';
import { DemoDataCard } from '../components/admin/DemoDataCard';

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

/**
 * Admin Settings Page (ROK-146)
 * Allows administrators to configure Discord OAuth credentials.
 */
export function AdminSettingsPage() {
    const navigate = useNavigate();
    const { user, isLoading: authLoading } = useAuth();
    const { oauthStatus, updateOAuth, testOAuth, clearOAuth, igdbStatus, updateIgdb, testIgdb, clearIgdb, blizzardStatus, updateBlizzard, testBlizzard, clearBlizzard, igdbSyncStatus, syncIgdb } = useAdminSettings();

    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [showSecret, setShowSecret] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    // IGDB form state
    const [igdbClientId, setIgdbClientId] = useState('');
    const [igdbClientSecret, setIgdbClientSecret] = useState('');
    const [showIgdbSecret, setShowIgdbSecret] = useState(false);
    const [igdbTestResult, setIgdbTestResult] = useState<{ success: boolean; message: string } | null>(null);

    // Blizzard form state (ROK-234)
    const [blizzardClientId, setBlizzardClientId] = useState('');
    const [blizzardClientSecret, setBlizzardClientSecret] = useState('');
    const [showBlizzardSecret, setShowBlizzardSecret] = useState(false);
    const [blizzardTestResult, setBlizzardTestResult] = useState<{ success: boolean; message: string } | null>(null);

    // Compute callback URLs using useMemo instead of useEffect to avoid setState in effect
    const callbackUrl = useMemo(() => {
        const apiPath = API_BASE_URL.startsWith('/') ? API_BASE_URL : '';
        if (apiPath) {
            // Production/Docker: goes through nginx proxy
            return `${window.location.origin}${apiPath}/auth/discord/callback`;
        } else {
            // Development: direct API access
            return `${API_BASE_URL}/auth/discord/callback`;
        }
    }, []);

    const linkCallbackUrl = useMemo(() => {
        return callbackUrl.replace('/callback', '/link/callback');
    }, [callbackUrl]);

    // Show loading state while auth is being checked
    if (authLoading) {
        return (
            <div className="max-w-2xl mx-auto px-4 py-8">
                <div className="animate-pulse">
                    <div className="h-8 bg-overlay rounded w-48 mb-4"></div>
                    <div className="h-4 bg-overlay rounded w-64 mb-8"></div>
                    <div className="bg-panel/50 rounded-xl h-96"></div>
                </div>
            </div>
        );
    }

    // Only admins can access this page
    if (!user?.isAdmin) {
        return (
            <div className="max-w-2xl mx-auto px-4 py-8">
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6">
                    <h2 className="text-xl font-semibold text-red-400">Access Denied</h2>
                    <p className="text-muted mt-2">
                        You must be an administrator to access this page.
                    </p>
                    <button
                        onClick={() => navigate('/')}
                        className="mt-4 px-4 py-2 bg-overlay hover:bg-faint rounded-lg text-foreground transition-colors"
                    >
                        Go Home
                    </button>
                </div>
            </div>
        );
    }

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setTestResult(null);

        if (!clientId || !clientSecret) {
            toast.error('Client ID and Client Secret are required');
            return;
        }

        try {
            const result = await updateOAuth.mutateAsync({
                clientId,
                clientSecret,
                callbackUrl,
            });

            if (result.success) {
                toast.success(result.message);
                // Clear the form secrets for security
                setClientId('');
                setClientSecret('');
            } else {
                toast.error(result.message);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to save configuration';
            toast.error(message);
        }
    };

    const handleTest = async () => {
        setTestResult(null);

        try {
            const result = await testOAuth.mutateAsync();
            setTestResult(result);

            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.message);
            }
        } catch {
            toast.error('Failed to test configuration');
        }
    };

    const handleClear = async () => {
        if (!confirm('Are you sure you want to clear the Discord OAuth configuration? Users will not be able to login with Discord.')) {
            return;
        }

        try {
            const result = await clearOAuth.mutateAsync();

            if (result.success) {
                toast.success(result.message);
                setTestResult(null);
            } else {
                toast.error(result.message);
            }
        } catch {
            toast.error('Failed to clear configuration');
        }
    };

    // IGDB handlers
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

            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.message);
            }
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

    // Blizzard handlers (ROK-234)
    const handleBlizzardSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setBlizzardTestResult(null);

        if (!blizzardClientId || !blizzardClientSecret) {
            toast.error('Client ID and Client Secret are required');
            return;
        }

        try {
            const result = await updateBlizzard.mutateAsync({
                clientId: blizzardClientId,
                clientSecret: blizzardClientSecret,
            });

            if (result.success) {
                toast.success(result.message);
                setBlizzardClientId('');
                setBlizzardClientSecret('');
            } else {
                toast.error(result.message);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to save configuration';
            toast.error(message);
        }
    };

    const handleBlizzardTest = async () => {
        setBlizzardTestResult(null);

        try {
            const result = await testBlizzard.mutateAsync();
            setBlizzardTestResult(result);

            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.message);
            }
        } catch {
            toast.error('Failed to test configuration');
        }
    };

    const handleBlizzardClear = async () => {
        if (!confirm('Are you sure you want to clear the Blizzard API configuration? WoW Armory import will be disabled.')) {
            return;
        }

        try {
            const result = await clearBlizzard.mutateAsync();

            if (result.success) {
                toast.success(result.message);
                setBlizzardTestResult(null);
            } else {
                toast.error(result.message);
            }
        } catch {
            toast.error('Failed to clear configuration');
        }
    };

    // Shared icon components to avoid duplication
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

    // Discord icon component
    const DiscordIcon = (
        <div className="w-10 h-10 rounded-lg bg-[#5865F2] flex items-center justify-center">
            <svg className="w-6 h-6 text-foreground" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
        </div>
    );

    return (
        <div className="max-w-2xl mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold text-foreground mb-2">Admin Settings</h1>
            <p className="text-muted mb-8">
                Configure OAuth providers and system settings.
            </p>

            {/* Discord OAuth Section */}
            <IntegrationCard
                title="Discord OAuth"
                description="Enable Discord login for users"
                icon={DiscordIcon}
                isConfigured={oauthStatus.data?.configured ?? false}
                isLoading={oauthStatus.isLoading}
                defaultExpanded={false}
            >
                {/* Setup Instructions */}
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
                    <p className="text-sm text-foreground">
                        <strong>Setup Instructions:</strong>
                    </p>
                    <ol className="text-sm text-secondary mt-2 space-y-1 list-decimal list-inside">
                        <li>Go to <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-100">Discord Developer Portal</a></li>
                        <li>Create or select an application</li>
                        <li>Go to OAuth2 → Copy Client ID and Client Secret</li>
                        <li>Add redirect URL to OAuth2 → Redirects</li>
                    </ol>
                </div>

                {/* Configuration Form */}
                <form onSubmit={handleSave} className="space-y-4">
                    <div>
                        <label htmlFor="clientId" className="block text-sm font-medium text-secondary mb-1.5">
                            Client ID
                        </label>
                        <input
                            id="clientId"
                            type="text"
                            value={clientId}
                            onChange={(e) => setClientId(e.target.value)}
                            placeholder={oauthStatus.data?.configured ? '••••••••••••••••••••' : 'Discord Application Client ID'}
                            className="w-full px-4 py-3 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                        />
                    </div>

                    <div>
                        <label htmlFor="clientSecret" className="block text-sm font-medium text-secondary mb-1.5">
                            Client Secret
                        </label>
                        <div className="relative">
                            <input
                                id="clientSecret"
                                type={showSecret ? 'text' : 'password'}
                                value={clientSecret}
                                onChange={(e) => setClientSecret(e.target.value)}
                                placeholder={oauthStatus.data?.configured ? '••••••••••••••••••••' : 'Discord Application Client Secret'}
                                className="w-full px-4 py-3 pr-12 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                            />
                            <button
                                type="button"
                                onClick={() => setShowSecret(!showSecret)}
                                aria-label={showSecret ? 'Hide password' : 'Show password'}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
                            >
                                {showSecret ? EyeOffIcon : EyeIcon}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-secondary mb-1.5">
                            <>Callback URLs <span className="text-dim">(add both to Discord)</span></>
                        </label>

                        {/* Login callback URL (always shown) */}
                        <div
                            className="relative cursor-pointer group mb-2"
                            onClick={async () => {
                                try {
                                    await navigator.clipboard.writeText(callbackUrl);
                                    toast.success('Callback URL copied!');
                                } catch {
                                    toast.error('Failed to copy');
                                }
                            }}
                        >
                            <input
                                type="text"
                                value={callbackUrl}
                                readOnly
                                className="w-full px-4 py-3 bg-surface/50 border border-edge rounded-lg text-foreground cursor-pointer select-all focus:outline-none group-hover:border-dim transition-all text-sm"
                            />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted group-hover:text-foreground transition-colors">
                                {CopyIcon}
                            </div>
                        </div>

                        {/* Link callback URL (always shown - users need to add both to Discord) */}
                        <div
                            className="relative cursor-pointer group"
                            onClick={async () => {
                                try {
                                    await navigator.clipboard.writeText(linkCallbackUrl);
                                    toast.success('Link callback copied!');
                                } catch {
                                    toast.error('Failed to copy');
                                }
                            }}
                        >
                            <input
                                type="text"
                                value={linkCallbackUrl}
                                readOnly
                                className="w-full px-4 py-3 bg-surface/50 border border-edge rounded-lg text-foreground cursor-pointer select-all focus:outline-none group-hover:border-dim transition-all text-sm"
                            />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted group-hover:text-foreground transition-colors">
                                {CopyIcon}
                            </div>
                        </div>

                        <p className="text-xs text-dim mt-1.5">
                            <>Click to copy. Add <strong>both</strong> URLs to Discord → OAuth2 → Redirects.</>
                        </p>
                    </div>

                    {/* Test Result */}
                    {testResult && (
                        <div className={`p-3 rounded-lg animate-[fadeIn_0.3s_ease-in] ${testResult.success
                            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                            : 'bg-red-500/10 border border-red-500/30 text-red-400'
                            }`}>
                            {testResult.message}
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex flex-wrap gap-3 pt-2">
                        <button
                            type="submit"
                            disabled={updateOAuth.isPending}
                            className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors"
                        >
                            {updateOAuth.isPending ? 'Saving...' : 'Save Configuration'}
                        </button>

                        {oauthStatus.data?.configured && (
                            <>
                                <button
                                    type="button"
                                    onClick={handleTest}
                                    disabled={testOAuth.isPending}
                                    className="py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors"
                                >
                                    {testOAuth.isPending ? 'Testing...' : 'Test Connection'}
                                </button>

                                <button
                                    type="button"
                                    onClick={handleClear}
                                    disabled={clearOAuth.isPending}
                                    className="py-3 px-4 bg-red-600/20 hover:bg-red-600/30 text-red-400 font-semibold rounded-lg transition-colors border border-red-600/50"
                                >
                                    Clear
                                </button>
                            </>
                        )}
                    </div>
                </form>
            </IntegrationCard>

            {/* IGDB / Twitch Section (ROK-229) */}
            <div className="mt-6">
                <IntegrationCard
                    title="IGDB / Twitch"
                    description="Enable game discovery and live streams"
                    icon={
                        <div className="w-10 h-10 rounded-lg bg-[#9146FF] flex items-center justify-center">
                            <svg className="w-6 h-6 text-foreground" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
                            </svg>
                        </div>
                    }
                    isConfigured={igdbStatus.data?.configured ?? false}
                    isLoading={igdbStatus.isLoading}
                    defaultExpanded={false}
                >
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

                    {/* Twitch Redirect URI (required by Twitch Dev Console, not used by client_credentials) */}
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
                </IntegrationCard>
            </div>

            {/* Blizzard API Section (ROK-234) */}
            <div className="mt-6">
                <IntegrationCard
                    title="Blizzard API"
                    description="Enable WoW Armory character import"
                    icon={
                        <div className="w-10 h-10 rounded-lg bg-[#148EFF] flex items-center justify-center">
                            <svg className="w-6 h-6 text-foreground" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M10.457 0c-.516 2.078-1.11 3.473-2.384 5.105C6.8 6.734 5.53 7.862 3.663 8.944c.563.07 1.097.254 1.097.254s-.453.602-.805 1.398c-.352.796-.555 1.578-.555 1.578s.77-.287 1.563-.399a8.522 8.522 0 0 1 1.867.02s-.164.566-.246 1.309c-.082.743-.07 1.324-.07 1.324s.468-.258 1.082-.457c.613-.2 1.27-.305 1.27-.305s-.063.523-.047 1.172c.016.648.098 1.281.098 1.281s.516-.336 1.008-.586c.492-.25.984-.414.984-.414s.078.43.246 1.016c.168.586.43 1.234.43 1.234s.37-.5.82-.953c.45-.453.926-.785.926-.785s.234.477.582.984c.348.508.719.934.719.934s.219-.434.457-.965c.238-.531.398-.961.398-.961s.48.477.875.738c.395.262.875.5.875.5s-.02-.52.051-1.114c.07-.593.184-1.038.184-1.038s.613.2 1.164.285c.55.086 1.085.102 1.085.102s-.164-.66-.164-1.309c0-.648.066-1.015.066-1.015s.602.168 1.176.25c.574.082 1.094.055 1.094.055s-.156-.703-.387-1.336c-.23-.633-.434-.992-.434-.992s.688.031 1.356-.082c.668-.113 1.242-.336 1.242-.336s-.312-.656-.77-1.273c-.457-.617-.774-.86-.774-.86s.652-.218.98-.413c.329-.195.75-.545.75-.545-1.512-.793-2.73-1.715-3.898-3.168C14.008 3.875 13.258 2.129 12.836 0c-.563 2.64-2.086 4.422-3.805 5.871C7.312 7.32 5.422 8.051 3.21 8.785c2.196.454 3.649 1.793 4.704 3.32 1.055 1.528 1.64 3.524 1.848 5.458l.23-.145s-.118-.652-.118-1.503c0-.852.137-1.86.137-1.86s.437.383.945.688c.508.304.879.414.879.414s-.035-.63.098-1.336c.133-.707.293-1.121.293-1.121s.531.242.934.367c.402.125.886.188.886.188s.02-.535-.008-1.172c-.027-.637-.113-1.172-.113-1.172s.539.11 1.086.152c.547.043 1.093.012 1.093.012s-.136-.59-.363-1.226c-.227-.637-.45-1-.45-1s.606.046 1.184-.063c.578-.11 1.09-.293 1.09-.293s-.266-.598-.645-1.172c-.379-.574-.695-.836-.695-.836s.523-.082 1.047-.254c.523-.172.883-.372.883-.372-1.648-.71-2.75-1.632-3.758-3.058-.434-.613-.786-1.273-1.117-2.097z" />
                            </svg>
                        </div>
                    }
                    isConfigured={blizzardStatus.data?.configured ?? false}
                    isLoading={blizzardStatus.isLoading}
                    defaultExpanded={false}
                >
                    {/* Setup Instructions */}
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
                        <p className="text-sm text-foreground">
                            <strong>Setup Instructions:</strong>
                        </p>
                        <ol className="text-sm text-secondary mt-2 space-y-1 list-decimal list-inside">
                            <li>Go to <a href="https://develop.battle.net/access/clients" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-300">Blizzard Developer Portal</a></li>
                            <li>Create or select an API client</li>
                            <li>Copy the Client ID and Client Secret</li>
                            <li>This enables WoW Armory character import for all users</li>
                        </ol>
                    </div>

                    {/* Configuration Form */}
                    <form onSubmit={handleBlizzardSave} className="space-y-4">
                        <div>
                            <label htmlFor="blizzardClientId" className="block text-sm font-medium text-secondary mb-1.5">
                                Client ID
                            </label>
                            <input
                                id="blizzardClientId"
                                type="text"
                                value={blizzardClientId}
                                onChange={(e) => setBlizzardClientId(e.target.value)}
                                placeholder={blizzardStatus.data?.configured ? '••••••••••••••••••••' : 'Blizzard API Client ID'}
                                className="w-full px-4 py-3 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                            />
                        </div>

                        <div>
                            <label htmlFor="blizzardClientSecret" className="block text-sm font-medium text-secondary mb-1.5">
                                Client Secret
                            </label>
                            <div className="relative">
                                <input
                                    id="blizzardClientSecret"
                                    type={showBlizzardSecret ? 'text' : 'password'}
                                    value={blizzardClientSecret}
                                    onChange={(e) => setBlizzardClientSecret(e.target.value)}
                                    placeholder={blizzardStatus.data?.configured ? '••••••••••••••••••••' : 'Blizzard API Client Secret'}
                                    className="w-full px-4 py-3 pr-12 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowBlizzardSecret(!showBlizzardSecret)}
                                    aria-label={showBlizzardSecret ? 'Hide password' : 'Show password'}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
                                >
                                    {showBlizzardSecret ? EyeOffIcon : EyeIcon}
                                </button>
                            </div>
                        </div>

                        {/* Test Result */}
                        {blizzardTestResult && (
                            <div className={`p-3 rounded-lg animate-[fadeIn_0.3s_ease-in] ${blizzardTestResult.success
                                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                                : 'bg-red-500/10 border border-red-500/30 text-red-400'
                                }`}>
                                {blizzardTestResult.message}
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex flex-wrap gap-3 pt-2">
                            <button
                                type="submit"
                                disabled={updateBlizzard.isPending}
                                className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors"
                            >
                                {updateBlizzard.isPending ? 'Saving...' : 'Save Configuration'}
                            </button>

                            {blizzardStatus.data?.configured && (
                                <>
                                    <button
                                        type="button"
                                        onClick={handleBlizzardTest}
                                        disabled={testBlizzard.isPending}
                                        className="py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors"
                                    >
                                        {testBlizzard.isPending ? 'Testing...' : 'Test Connection'}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={handleBlizzardClear}
                                        disabled={clearBlizzard.isPending}
                                        className="py-3 px-4 bg-red-600/20 hover:bg-red-600/30 text-red-400 font-semibold rounded-lg transition-colors border border-red-600/50"
                                    >
                                        Clear
                                    </button>
                                </>
                            )}
                        </div>
                    </form>
                </IntegrationCard>
            </div>

            {/* Game Library Management */}
            <GameLibraryTable />

            {/* Demo Data Management (ROK-193) */}
            <DemoDataCard />

            {/* Back Link */}
            <button
                onClick={() => navigate(-1)}
                className="mt-6 text-muted hover:text-foreground transition-colors"
            >
                ← Back
            </button>
        </div >
    );
}
