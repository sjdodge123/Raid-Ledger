import { useState } from 'react';
import { toast } from '../../lib/toast';
import { useAdminSettings } from '../../hooks/use-admin-settings';

export function SteamForm() {
    const { steamStatus, updateSteam, testSteam, clearSteam } = useAdminSettings();

    const [apiKey, setApiKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setTestResult(null);

        if (!apiKey.trim()) {
            toast.error('API key is required');
            return;
        }

        try {
            const result = await updateSteam.mutateAsync({ apiKey: apiKey.trim() });
            if (result.success) {
                toast.success(result.message);
                setApiKey('');
            } else {
                toast.error(result.message);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to save configuration');
        }
    };

    const handleTest = async () => {
        setTestResult(null);
        try {
            const result = await testSteam.mutateAsync();
            setTestResult(result);
            if (result.success) toast.success(result.message);
            else toast.error(result.message);
        } catch {
            toast.error('Failed to test configuration');
        }
    };

    const handleClear = async () => {
        try {
            const result = await clearSteam.mutateAsync();
            toast.success(result.message);
            setTestResult(null);
        } catch {
            toast.error('Failed to clear configuration');
        }
    };

    const isConfigured = steamStatus.data?.configured ?? false;

    return (
        <div className="space-y-4">
            {isConfigured && (
                <div className="flex items-center gap-2 text-sm">
                    <span className="text-emerald-400">Steam API key is configured</span>
                    <button
                        onClick={handleTest}
                        disabled={testSteam.isPending}
                        className="text-accent hover:text-accent/80 underline underline-offset-2 disabled:opacity-50"
                    >
                        {testSteam.isPending ? 'Testing...' : 'Test Connection'}
                    </button>
                    <span className="text-muted">|</span>
                    <button
                        onClick={handleClear}
                        disabled={clearSteam.isPending}
                        className="text-red-400 hover:text-red-300 underline underline-offset-2 disabled:opacity-50"
                    >
                        {clearSteam.isPending ? 'Clearing...' : 'Clear'}
                    </button>
                </div>
            )}

            {testResult && (
                <div
                    className={`text-sm px-3 py-2 rounded-lg border ${
                        testResult.success
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                            : 'bg-red-500/10 border-red-500/30 text-red-400'
                    }`}
                >
                    {testResult.message}
                </div>
            )}

            <form onSubmit={handleSave} className="space-y-3">
                <div>
                    <label className="block text-sm text-secondary mb-1">Steam Web API Key</label>
                    <div className="relative">
                        <input
                            type={showKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder={isConfigured ? '••••••••' : 'Enter your Steam API key'}
                            className="w-full bg-overlay border border-edge/50 rounded-lg px-3 py-2 pr-10 text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                        <button
                            type="button"
                            onClick={() => setShowKey(!showKey)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                        >
                            {showKey ? (
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
                    <p className="mt-1 text-xs text-muted">
                        Get your free API key from{' '}
                        <a
                            href="https://steamcommunity.com/dev/apikey"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline"
                        >
                            steamcommunity.com/dev/apikey
                        </a>
                    </p>
                </div>

                <button
                    type="submit"
                    disabled={!apiKey.trim() || updateSteam.isPending}
                    className="px-4 py-2 text-sm bg-accent hover:bg-accent/80 disabled:bg-accent/30 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors"
                >
                    {updateSteam.isPending ? 'Saving...' : 'Save API Key'}
                </button>
            </form>
        </div>
    );
}
