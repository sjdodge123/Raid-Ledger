import { useState } from 'react';
import { toast } from '../../lib/toast';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { PasswordInput, TestResultBanner } from './admin-form-helpers';

function SetupInstructions() {
    return (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
            <p className="text-sm text-foreground font-semibold mb-2">Setup Instructions</p>
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
                <li>Go to the <strong>OAuth2 {'\u2192'} URL Generator</strong> tab</li>
                <li>Under <strong>Scopes</strong>, check <strong>bot</strong> and <strong>applications.commands</strong></li>
                <li>A <strong>Bot Permissions</strong> section will appear {'\u2014'} enable these permissions:</li>
                <li className="ml-4"><strong>General:</strong> <em>Manage Roles</em>, <em>Manage Channels</em>, <em>Create Instant Invite</em>, <em>Manage Events</em>, <em>Create Events</em>, <em>Manage Expressions</em>, <em>Create Expressions</em>, <em>View Channels</em></li>
                <li className="ml-4"><strong>Text:</strong> <em>Send Messages</em>, <em>Embed Links</em>, <em>Read Message History</em>, <em>Create Polls</em></li>
                <li className="ml-4"><strong>Voice:</strong> <em>Connect</em></li>
                <li>Copy the generated URL, open it in your browser, and select your server</li>
            </ul>
        </div>
    );
}

function EnableToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
    return (
        <div className="flex items-center justify-between">
            <label htmlFor="botEnabled" className="text-sm font-medium text-secondary">Enable Bot</label>
            <button type="button" role="switch" id="botEnabled" aria-checked={enabled} onClick={onToggle}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-emerald-500' : 'bg-gray-600'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
        </div>
    );
}

function BotActionButtons({ configured, botToken, isPending, onTest, onClear }: {
    configured: boolean; botToken: string; isPending: { save: boolean; test: boolean; clear: boolean };
    onTest: () => void; onClear: () => void;
}) {
    return (
        <div className="flex flex-wrap gap-3 pt-2">
            <button type="submit" disabled={isPending.save}
                className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors">
                {isPending.save ? 'Saving...' : 'Save Configuration'}
            </button>
            {(configured || botToken) && (
                <button type="button" onClick={onTest} disabled={isPending.test}
                    className="py-3 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors">
                    {isPending.test ? 'Testing...' : 'Test Connection'}
                </button>
            )}
            {configured && (
                <button type="button" onClick={onClear} disabled={isPending.clear}
                    className="py-3 px-4 bg-red-600/20 hover:bg-red-600/30 text-red-400 font-semibold rounded-lg transition-colors border border-red-600/50">Clear</button>
            )}
        </div>
    );
}

function botStatusLabel(data: { connecting?: boolean; connected?: boolean }) {
    if (data.connecting) return 'Starting...';
    if (data.connected) return 'Online';
    return 'Offline';
}

function botStatusDotClass(data: { connecting?: boolean; connected?: boolean }) {
    if (data.connecting) return 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse';
    if (data.connected) return 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]';
    return 'bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.6)]';
}

function BotStatusBar({ data, onCheckPermissions, isChecking }: {
    data: { connecting?: boolean; connected?: boolean; guildName?: string; memberCount?: number | null };
    onCheckPermissions: () => void; isChecking: boolean;
}) {
    return (
        <div className="flex items-center gap-3 bg-surface/30 rounded-lg p-4">
            <div className={`w-3 h-3 rounded-full ${botStatusDotClass(data)}`} />
            <div className="flex-1">
                <span className="text-sm font-medium text-foreground">{botStatusLabel(data)}</span>
                {data.connected && data.guildName && (
                    <p className="text-xs text-secondary mt-0.5">
                        {data.guildName}{data.memberCount != null && <span className="text-dim"> &middot; {data.memberCount} members</span>}
                    </p>
                )}
            </div>
            {data.connected && (
                <button type="button" onClick={onCheckPermissions} disabled={isChecking}
                    className="py-2 px-3 text-xs bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors">
                    {isChecking ? 'Checking\u2026' : 'Test Permissions'}
                </button>
            )}
        </div>
    );
}

function PermissionsResult({ result }: { result: { allGranted: boolean; permissions: { name: string; granted: boolean }[] } | null }) {
    if (!result) return null;
    return (
        <div className={`mt-3 rounded-lg p-4 animate-[fadeIn_0.3s_ease-in] ${result.allGranted ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-amber-500/10 border border-amber-500/30'}`}>
            <p className={`text-xs font-semibold mb-2 ${result.allGranted ? 'text-emerald-400' : 'text-amber-400'}`}>
                {result.allGranted ? '\u2713 All required permissions granted' : '\u26A0 Some permissions are missing \u2014 re-invite the bot with the correct permissions'}
            </p>
            <div className="space-y-1">
                {result.permissions.map((p) => (
                    <div key={p.name} className="flex items-center gap-2 text-xs">
                        <span className={p.granted ? 'text-emerald-400' : 'text-red-400'}>{p.granted ? '\u2713' : '\u2717'}</span>
                        <span className={p.granted ? 'text-secondary' : 'text-red-300'}>{p.name}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function useBotFormState() {
    const { discordBotStatus, updateDiscordBot, testDiscordBot, clearDiscordBot, checkDiscordBotPermissions } = useAdminSettings();
    const [botToken, setBotToken] = useState('');
    const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);
    const [showToken, setShowToken] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; guildName?: string; message: string } | null>(null);
    const [permissionsResult, setPermissionsResult] = useState<{ allGranted: boolean; permissions: { name: string; granted: boolean }[] } | null>(null);
    const enabled = enabledOverride ?? discordBotStatus.data?.enabled ?? true;

    return {
        discordBotStatus, updateDiscordBot, testDiscordBot, clearDiscordBot, checkDiscordBotPermissions,
        botToken, setBotToken, showToken, setShowToken, enabled, enabledOverride, setEnabledOverride,
        testResult, setTestResult, permissionsResult, setPermissionsResult,
    };
}

async function executeBotSave(s: ReturnType<typeof useBotFormState>, e: React.FormEvent) {
    e.preventDefault(); s.setTestResult(null);
    if (!s.botToken) { toast.error('Bot token is required'); return; }
    try {
        const r = await s.updateDiscordBot.mutateAsync({ botToken: s.botToken, enabled: s.enabled });
        if (r.success) { toast.success(r.message); s.setBotToken(''); s.setEnabledOverride(null); } else toast.error(r.message);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to save configuration'); }
}

async function executeBotClear(s: ReturnType<typeof useBotFormState>) {
    if (!confirm('Are you sure you want to clear the Discord bot configuration? The bot will be disconnected.')) return;
    try { const r = await s.clearDiscordBot.mutateAsync(); if (r.success) { toast.success(r.message); s.setTestResult(null); s.setPermissionsResult(null); } else toast.error(r.message); }
    catch { toast.error('Failed to clear configuration'); }
}

function useBotHandlers() {
    const s = useBotFormState();

    const handleTest = async () => {
        s.setTestResult(null);
        try { const r = await s.testDiscordBot.mutateAsync({ botToken: s.botToken || undefined }); s.setTestResult(r); if (r.success) toast.success(r.message); }
        catch { toast.error('Failed to test connection'); }
    };

    const handleCheckPermissions = async () => {
        s.setPermissionsResult(null);
        try { const r = await s.checkDiscordBotPermissions.mutateAsync(); s.setPermissionsResult(r); if (r.allGranted) toast.success('All required permissions are granted!'); else toast.error('Some required permissions are missing.'); }
        catch { toast.error('Failed to check permissions'); }
    };

    return {
        discordBotStatus: s.discordBotStatus, botToken: s.botToken, setBotToken: s.setBotToken,
        showToken: s.showToken, setShowToken: s.setShowToken, enabled: s.enabled, setEnabledOverride: s.setEnabledOverride,
        testResult: s.testResult, permissionsResult: s.permissionsResult,
        handleSave: (e: React.FormEvent) => executeBotSave(s, e), handleTest, handleClear: () => executeBotClear(s), handleCheckPermissions,
        isPending: { save: s.updateDiscordBot.isPending, test: s.testDiscordBot.isPending, clear: s.clearDiscordBot.isPending, perms: s.checkDiscordBotPermissions.isPending },
    };
}

export function DiscordBotForm() {
    const h = useBotHandlers();

    return (
        <>
            <SetupInstructions />
            <form onSubmit={h.handleSave} className="space-y-4">
                <div>
                    <label htmlFor="botToken" className="block text-sm font-medium text-secondary mb-1.5">Bot Token</label>
                    <PasswordInput id="botToken" value={h.botToken} onChange={h.setBotToken}
                        placeholder={h.discordBotStatus.data?.configured ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'Discord Bot Token'}
                        showPassword={h.showToken} onToggleShow={() => h.setShowToken(!h.showToken)} ringColor="focus:ring-blue-500" fieldLabel="token" />
                </div>
                <EnableToggle enabled={h.enabled} onToggle={() => h.setEnabledOverride(!h.enabled)} />
                <TestResultBanner result={h.testResult} />
                <BotActionButtons configured={!!h.discordBotStatus.data?.configured} botToken={h.botToken}
                    isPending={h.isPending} onTest={h.handleTest} onClear={h.handleClear} />
            </form>
            {h.discordBotStatus.data?.configured && (
                <div className="mt-6 pt-6 border-t border-edge/50">
                    <BotStatusBar data={h.discordBotStatus.data} onCheckPermissions={h.handleCheckPermissions} isChecking={h.isPending.perms} />
                    <PermissionsResult result={h.permissionsResult} />
                </div>
            )}
        </>
    );
}
