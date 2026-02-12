import { useState, useMemo } from 'react';
import { toast } from '../../lib/toast';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { API_BASE_URL } from '../../lib/config';

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

export function DiscordOAuthForm() {
    const { oauthStatus, updateOAuth, testOAuth, clearOAuth } = useAdminSettings();

    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [showSecret, setShowSecret] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    const callbackUrl = useMemo(() => {
        const apiPath = API_BASE_URL.startsWith('/') ? API_BASE_URL : '';
        if (apiPath) {
            return `${window.location.origin}${apiPath}/auth/discord/callback`;
        } else {
            return `${API_BASE_URL}/auth/discord/callback`;
        }
    }, []);

    const linkCallbackUrl = useMemo(() => {
        return callbackUrl.replace('/callback', '/link/callback');
    }, [callbackUrl]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setTestResult(null);

        if (!clientId || !clientSecret) {
            toast.error('Client ID and Client Secret are required');
            return;
        }

        try {
            const result = await updateOAuth.mutateAsync({ clientId, clientSecret, callbackUrl });
            if (result.success) {
                toast.success(result.message);
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
            if (result.success) toast.success(result.message);
            else toast.error(result.message);
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

    return (
        <>
            {/* Setup Instructions */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
                <p className="text-sm text-foreground">
                    <strong>Setup Instructions:</strong>
                </p>
                <ol className="text-sm text-secondary mt-2 space-y-1 list-decimal list-inside">
                    <li>Go to <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-100">Discord Developer Portal</a></li>
                    <li>Create or select an application</li>
                    <li>Go to OAuth2 &rarr; Copy Client ID and Client Secret</li>
                    <li>Add redirect URL to OAuth2 &rarr; Redirects</li>
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
                        <>Click to copy. Add <strong>both</strong> URLs to Discord &rarr; OAuth2 &rarr; Redirects.</>
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
        </>
    );
}
