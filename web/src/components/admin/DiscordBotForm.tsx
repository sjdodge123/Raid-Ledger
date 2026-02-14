import { useState } from 'react';
import { toast } from '../../lib/toast';
import { useAdminSettings } from '../../hooks/use-admin-settings';

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

export function DiscordBotForm() {
    const { discordBotStatus, updateDiscordBot, testDiscordBot, clearDiscordBot } = useAdminSettings();

    const [botToken, setBotToken] = useState('');
    const [enabled, setEnabled] = useState(true);
    const [showToken, setShowToken] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; guildName?: string; message: string } | null>(null);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setTestResult(null);

        if (!botToken) {
            toast.error('Bot token is required');
            return;
        }

        try {
            const result = await updateDiscordBot.mutateAsync({ botToken, enabled });
            if (result.success) {
                toast.success(result.message);
                setBotToken('');
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
            const result = await testDiscordBot.mutateAsync({ botToken: botToken || undefined });
            setTestResult(result);
            if (result.success) toast.success(result.message);
            else toast.error(result.message);
        } catch {
            toast.error('Failed to test connection');
        }
    };

    const handleClear = async () => {
        if (!confirm('Are you sure you want to clear the Discord bot configuration? The bot will be disconnected.')) {
            return;
        }
        try {
            const result = await clearDiscordBot.mutateAsync();
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
                    <li>Go to Bot &rarr; Copy the bot token</li>
                    <li>Under Privileged Gateway Intents, enable Server Members Intent</li>
                    <li>Go to OAuth2 &rarr; URL Generator, select &quot;bot&quot; scope, then invite to your server</li>
                </ol>
            </div>

            {/* Configuration Form */}
            <form onSubmit={handleSave} className="space-y-4">
                <div>
                    <label htmlFor="botToken" className="block text-sm font-medium text-secondary mb-1.5">
                        Bot Token
                    </label>
                    <div className="relative">
                        <input
                            id="botToken"
                            type={showToken ? 'text' : 'password'}
                            value={botToken}
                            onChange={(e) => setBotToken(e.target.value)}
                            placeholder={discordBotStatus.data?.configured ? '••••••••••••••••••••' : 'Discord Bot Token'}
                            className="w-full px-4 py-3 pr-12 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        />
                        <button
                            type="button"
                            onClick={() => setShowToken(!showToken)}
                            aria-label={showToken ? 'Hide token' : 'Show token'}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
                        >
                            {showToken ? EyeOffIcon : EyeIcon}
                        </button>
                    </div>
                </div>

                {/* Enable/Disable Toggle */}
                <div className="flex items-center justify-between">
                    <label htmlFor="botEnabled" className="text-sm font-medium text-secondary">
                        Enable Bot
                    </label>
                    <button
                        type="button"
                        role="switch"
                        id="botEnabled"
                        aria-checked={enabled}
                        onClick={() => setEnabled(!enabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            enabled ? 'bg-emerald-500' : 'bg-gray-600'
                        }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                enabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
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
                        disabled={updateDiscordBot.isPending}
                        className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors"
                    >
                        {updateDiscordBot.isPending ? 'Saving...' : 'Save Configuration'}
                    </button>

                    {(discordBotStatus.data?.configured || botToken) && (
                        <button
                            type="button"
                            onClick={handleTest}
                            disabled={testDiscordBot.isPending}
                            className="py-3 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors"
                        >
                            {testDiscordBot.isPending ? 'Testing...' : 'Test Connection'}
                        </button>
                    )}

                    {discordBotStatus.data?.configured && (
                        <button
                            type="button"
                            onClick={handleClear}
                            disabled={clearDiscordBot.isPending}
                            className="py-3 px-4 bg-red-600/20 hover:bg-red-600/30 text-red-400 font-semibold rounded-lg transition-colors border border-red-600/50"
                        >
                            Clear
                        </button>
                    )}
                </div>
            </form>

            {/* Bot Status (when configured) */}
            {discordBotStatus.data?.configured && (
                <div className="mt-6 pt-6 border-t border-edge/50">
                    <div className="flex items-center gap-3 bg-surface/30 rounded-lg p-4">
                        <div className={`w-3 h-3 rounded-full ${
                            discordBotStatus.data.connected
                                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]'
                                : 'bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                        }`} />
                        <div className="flex-1">
                            <span className="text-sm font-medium text-foreground">
                                {discordBotStatus.data.connected ? 'Online' : 'Offline'}
                            </span>
                            {discordBotStatus.data.connected && discordBotStatus.data.guildName && (
                                <p className="text-xs text-secondary mt-0.5">
                                    {discordBotStatus.data.guildName}
                                    {discordBotStatus.data.memberCount != null && (
                                        <span className="text-dim"> &middot; {discordBotStatus.data.memberCount} members</span>
                                    )}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
