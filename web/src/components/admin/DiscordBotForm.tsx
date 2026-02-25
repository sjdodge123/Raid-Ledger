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
    const { discordBotStatus, updateDiscordBot, testDiscordBot, clearDiscordBot, checkDiscordBotPermissions, resendSetupWizard } = useAdminSettings();

    const [botToken, setBotToken] = useState('');
    const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);
    const [showToken, setShowToken] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; guildName?: string; message: string } | null>(null);
    const [permissionsResult, setPermissionsResult] = useState<{ allGranted: boolean; permissions: { name: string; granted: boolean }[] } | null>(null);

    const enabled = enabledOverride ?? discordBotStatus.data?.enabled ?? true;

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
                setEnabledOverride(null);
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
                setPermissionsResult(null);
            } else {
                toast.error(result.message);
            }
        } catch {
            toast.error('Failed to clear configuration');
        }
    };

    const handleCheckPermissions = async () => {
        setPermissionsResult(null);
        try {
            const result = await checkDiscordBotPermissions.mutateAsync();
            setPermissionsResult(result);
            if (result.allGranted) toast.success('All required permissions are granted!');
            else toast.error('Some required permissions are missing.');
        } catch {
            toast.error('Failed to check permissions');
        }
    };

    return (
        <>
            {/* Setup Instructions */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
                <p className="text-sm text-foreground font-semibold mb-2">
                    Setup Instructions
                </p>

                <p className="text-xs text-secondary font-semibold mt-2 mb-1">1. Create a Bot</p>
                <ul className="text-xs text-secondary space-y-0.5 list-disc list-inside ml-2">
                    <li>Go to the <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-300">Discord Developer Portal</a></li>
                    <li>Click <strong>New Application</strong>, name it, then go to the <strong>Bot</strong> tab</li>
                    <li>Click <strong>Reset Token</strong> to generate a bot token and paste it below</li>
                </ul>

                <p className="text-xs text-secondary font-semibold mt-3 mb-1">2. Enable Privileged Intents</p>
                <ul className="text-xs text-secondary space-y-0.5 list-disc list-inside ml-2">
                    <li>On the <strong>Bot</strong> tab, scroll to <strong>Privileged Gateway Intents</strong></li>
                    <li>Enable all three: <strong>Presence Intent</strong>, <strong>Server Members Intent</strong>, and <strong>Message Content Intent</strong></li>
                    <li>Click <strong>Save Changes</strong></li>
                </ul>

                <p className="text-xs text-secondary font-semibold mt-3 mb-1">3. Invite Bot to Your Server</p>
                <ul className="text-xs text-secondary space-y-0.5 list-disc list-inside ml-2">
                    <li>Go to the <strong>OAuth2 → URL Generator</strong> tab</li>
                    <li>Under <strong>Scopes</strong>, check <strong>bot</strong> and <strong>applications.commands</strong></li>
                    <li>A <strong>Bot Permissions</strong> section will appear — enable these permissions:</li>
                    <li className="ml-4"><strong>General:</strong> <em>Manage Roles</em>, <em>Manage Channels</em>, <em>Manage Guild Expressions</em>, <em>Create Instant Invite</em>, <em>View Channels</em></li>
                    <li className="ml-4"><strong>Text:</strong> <em>Send Messages</em>, <em>Embed Links</em>, <em>Read Message History</em></li>
                    <li>Copy the generated URL, open it in your browser, and select your server</li>
                </ul>
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
                        onClick={() => setEnabledOverride(!enabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-emerald-500' : 'bg-gray-600'
                            }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'
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

            {/* Setup Wizard Reminder Banner (ROK-349) */}
            {discordBotStatus.data?.configured && discordBotStatus.data?.connected && discordBotStatus.data?.setupCompleted === false && (
                <div className="mt-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg animate-[fadeIn_0.3s_ease-in]">
                    <div className="flex items-start gap-3">
                        <span className="text-amber-400 text-lg flex-shrink-0">&#9888;</span>
                        <div className="flex-1">
                            <p className="text-sm font-semibold text-amber-300">Complete Discord Setup</p>
                            <p className="text-xs text-secondary mt-1">
                                The setup wizard has not been completed yet. Pick a default announcement channel and confirm your community name to get the most out of the Discord bot.
                            </p>
                            <button
                                type="button"
                                onClick={async () => {
                                    try {
                                        const result = await resendSetupWizard.mutateAsync();
                                        if (result.success) toast.success('Setup wizard DM sent! Check your Discord DMs.');
                                    } catch {
                                        toast.error('Failed to send setup wizard. Make sure the bot is connected and your Discord account is linked.');
                                    }
                                }}
                                disabled={resendSetupWizard.isPending}
                                className="mt-3 py-2 px-4 text-xs bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors"
                            >
                                {resendSetupWizard.isPending ? 'Sending...' : 'Complete Setup'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bot Status (when configured) */}
            {discordBotStatus.data?.configured && (
                <div className="mt-6 pt-6 border-t border-edge/50">
                    <div className="flex items-center gap-3 bg-surface/30 rounded-lg p-4">
                        <div className={`w-3 h-3 rounded-full ${discordBotStatus.data.connecting
                            ? 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse'
                            : discordBotStatus.data.connected
                                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]'
                                : 'bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                            }`} />
                        <div className="flex-1">
                            <span className="text-sm font-medium text-foreground">
                                {discordBotStatus.data.connecting
                                    ? 'Starting...'
                                    : discordBotStatus.data.connected
                                        ? 'Online'
                                        : 'Offline'}
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
                        {discordBotStatus.data.connected && (
                            <button
                                type="button"
                                onClick={handleCheckPermissions}
                                disabled={checkDiscordBotPermissions.isPending}
                                className="py-2 px-3 text-xs bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors"
                            >
                                {checkDiscordBotPermissions.isPending ? 'Checking…' : 'Test Permissions'}
                            </button>
                        )}
                    </div>

                    {/* Permissions Check Results */}
                    {permissionsResult && (
                        <div className={`mt-3 rounded-lg p-4 animate-[fadeIn_0.3s_ease-in] ${permissionsResult.allGranted
                            ? 'bg-emerald-500/10 border border-emerald-500/30'
                            : 'bg-amber-500/10 border border-amber-500/30'
                            }`}>
                            <p className={`text-xs font-semibold mb-2 ${permissionsResult.allGranted ? 'text-emerald-400' : 'text-amber-400'
                                }`}>
                                {permissionsResult.allGranted
                                    ? '✓ All required permissions granted'
                                    : '⚠ Some permissions are missing — re-invite the bot with the correct permissions'}
                            </p>
                            <div className="space-y-1">
                                {permissionsResult.permissions.map((p) => (
                                    <div key={p.name} className="flex items-center gap-2 text-xs">
                                        <span className={p.granted ? 'text-emerald-400' : 'text-red-400'}>
                                            {p.granted ? '✓' : '✗'}
                                        </span>
                                        <span className={p.granted ? 'text-secondary' : 'text-red-300'}>
                                            {p.name}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                </div>
            )}
        </>
    );
}
