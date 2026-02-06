import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { useAdminSettings } from '../hooks/use-admin-settings';
import { IntegrationCard } from '../components/admin/IntegrationCard';
import { API_BASE_URL } from '../lib/config';

/**
 * Admin Settings Page (ROK-146)
 * Allows administrators to configure Discord OAuth credentials.
 */
export function AdminSettingsPage() {
    const navigate = useNavigate();
    const { user, isLoading: authLoading } = useAuth();
    const { oauthStatus, updateOAuth, testOAuth, clearOAuth } = useAdminSettings();

    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [callbackUrl, setCallbackUrl] = useState('');
    const [showSecret, setShowSecret] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    useEffect(() => {
        // Always compute callback URL dynamically based on environment
        // Don't use cached value - this ensures correct URL for current setup
        const apiPath = API_BASE_URL.startsWith('/') ? API_BASE_URL : '';
        if (apiPath) {
            // Production/Docker: goes through nginx proxy (e.g., https://yourdomain.com/api/auth/discord/callback)
            setCallbackUrl(`${window.location.origin}${apiPath}/auth/discord/callback`);
        } else {
            // Development: direct API access (e.g., http://localhost:3000/auth/discord/callback)
            setCallbackUrl(`${API_BASE_URL}/auth/discord/callback`);
        }
    }, []);

    // Show loading state while auth is being checked
    if (authLoading) {
        return (
            <div className="max-w-2xl mx-auto px-4 py-8">
                <div className="animate-pulse">
                    <div className="h-8 bg-slate-700 rounded w-48 mb-4"></div>
                    <div className="h-4 bg-slate-700 rounded w-64 mb-8"></div>
                    <div className="bg-slate-800/50 rounded-xl h-96"></div>
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
                    <p className="text-slate-400 mt-2">
                        You must be an administrator to access this page.
                    </p>
                    <button
                        onClick={() => navigate('/')}
                        className="mt-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white transition-colors"
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

    // Discord icon component
    const DiscordIcon = (
        <div className="w-10 h-10 rounded-lg bg-[#5865F2] flex items-center justify-center">
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
        </div>
    );

    return (
        <div className="max-w-2xl mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold text-white mb-2">Admin Settings</h1>
            <p className="text-slate-400 mb-8">
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
                    <p className="text-sm text-blue-300">
                        <strong>Setup Instructions:</strong>
                    </p>
                    <ol className="text-sm text-blue-200 mt-2 space-y-1 list-decimal list-inside">
                        <li>Go to <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-100">Discord Developer Portal</a></li>
                        <li>Create or select an application</li>
                        <li>Go to OAuth2 → Copy Client ID and Client Secret</li>
                        <li>Add redirect URL to OAuth2 → Redirects</li>
                    </ol>
                </div>

                {/* Configuration Form */}
                <form onSubmit={handleSave} className="space-y-4">
                    <div>
                        <label htmlFor="clientId" className="block text-sm font-medium text-slate-300 mb-1.5">
                            Client ID
                        </label>
                        <input
                            id="clientId"
                            type="text"
                            value={clientId}
                            onChange={(e) => setClientId(e.target.value)}
                            placeholder={oauthStatus.data?.configured ? '••••••••••••••••••••' : 'Discord Application Client ID'}
                            className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                        />
                    </div>

                    <div>
                        <label htmlFor="clientSecret" className="block text-sm font-medium text-slate-300 mb-1.5">
                            Client Secret
                        </label>
                        <div className="relative">
                            <input
                                id="clientSecret"
                                type={showSecret ? 'text' : 'password'}
                                value={clientSecret}
                                onChange={(e) => setClientSecret(e.target.value)}
                                placeholder={oauthStatus.data?.configured ? '••••••••••••••••••••' : 'Discord Application Client Secret'}
                                className="w-full px-4 py-3 pr-12 bg-slate-900/50 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                            />
                            <button
                                type="button"
                                onClick={() => setShowSecret(!showSecret)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                            >
                                {showSecret ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1.5">
                            Callback URLs <span className="text-slate-500">(add both to Discord)</span>
                        </label>

                        {/* Login callback URL */}
                        <div
                            className="relative cursor-pointer group mb-2"
                            onClick={async () => {
                                try {
                                    await navigator.clipboard.writeText(callbackUrl);
                                    toast.success('Login callback copied!');
                                } catch {
                                    toast.error('Failed to copy');
                                }
                            }}
                        >
                            <input
                                type="text"
                                value={callbackUrl}
                                readOnly
                                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-lg text-white cursor-pointer select-all focus:outline-none group-hover:border-slate-500 transition-all text-sm"
                            />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 group-hover:text-white transition-colors">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                            </div>
                        </div>

                        {/* Link callback URL */}
                        <div
                            className="relative cursor-pointer group"
                            onClick={async () => {
                                try {
                                    const linkUrl = callbackUrl.replace('/callback', '/link/callback');
                                    await navigator.clipboard.writeText(linkUrl);
                                    toast.success('Link callback copied!');
                                } catch {
                                    toast.error('Failed to copy');
                                }
                            }}
                        >
                            <input
                                type="text"
                                value={callbackUrl.replace('/callback', '/link/callback')}
                                readOnly
                                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-lg text-white cursor-pointer select-all focus:outline-none group-hover:border-slate-500 transition-all text-sm"
                            />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 group-hover:text-white transition-colors">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                            </div>
                        </div>

                        <p className="text-xs text-slate-500 mt-1.5">
                            Click to copy. Add <strong>both</strong> URLs to Discord → OAuth2 → Redirects.
                        </p>
                    </div>

                    {/* Test Result */}
                    {testResult && (
                        <div className={`p-3 rounded-lg ${testResult.success
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
                            className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
                        >
                            {updateOAuth.isPending ? 'Saving...' : 'Save Configuration'}
                        </button>

                        {oauthStatus.data?.configured && (
                            <>
                                <button
                                    type="button"
                                    onClick={handleTest}
                                    disabled={testOAuth.isPending}
                                    className="py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
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

            {/* Back Link */}
            <button
                onClick={() => navigate(-1)}
                className="mt-6 text-slate-400 hover:text-white transition-colors"
            >
                ← Back
            </button>
        </div >
    );
}
