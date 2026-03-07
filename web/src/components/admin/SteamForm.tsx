import { useState } from 'react';
import { toast } from '../../lib/toast';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { PasswordInput, TestResultBanner } from './admin-form-helpers';

function useSteamHandlers() {
    const { steamStatus, updateSteam, testSteam, clearSteam } = useAdminSettings();
    const [apiKey, setApiKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setTestResult(null);
        if (!apiKey.trim()) { toast.error('API key is required'); return; }
        try {
            const r = await updateSteam.mutateAsync({ apiKey: apiKey.trim() });
            if (r.success) { toast.success(r.message); setApiKey(''); } else toast.error(r.message);
        } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to save configuration'); }
    };

    const handleTest = async () => {
        setTestResult(null);
        try { const r = await testSteam.mutateAsync(); setTestResult(r); if (r.success) toast.success(r.message); else toast.error(r.message); }
        catch { toast.error('Failed to test configuration'); }
    };

    const handleClear = async () => {
        try { const r = await clearSteam.mutateAsync(); toast.success(r.message); setTestResult(null); }
        catch { toast.error('Failed to clear configuration'); }
    };

    return { steamStatus, apiKey, setApiKey, showKey, setShowKey, testResult, handleSave, handleTest, handleClear,
        isPending: { save: updateSteam.isPending, test: testSteam.isPending, clear: clearSteam.isPending } };
}

function ConfiguredStatus({ onTest, onClear, isPending }: { onTest: () => void; onClear: () => void; isPending: { test: boolean; clear: boolean } }) {
    return (
        <div className="flex items-center gap-2 text-sm">
            <span className="text-emerald-400">Steam API key is configured</span>
            <button onClick={onTest} disabled={isPending.test} className="text-accent hover:text-accent/80 underline underline-offset-2 disabled:opacity-50">
                {isPending.test ? 'Testing...' : 'Test Connection'}
            </button>
            <span className="text-muted">|</span>
            <button onClick={onClear} disabled={isPending.clear} className="text-red-400 hover:text-red-300 underline underline-offset-2 disabled:opacity-50">
                {isPending.clear ? 'Clearing...' : 'Clear'}
            </button>
        </div>
    );
}

export function SteamForm() {
    const h = useSteamHandlers();
    const isConfigured = h.steamStatus.data?.configured ?? false;

    return (
        <div className="space-y-4">
            {isConfigured && <ConfiguredStatus onTest={h.handleTest} onClear={h.handleClear} isPending={h.isPending} />}
            <TestResultBanner result={h.testResult} />
            <form onSubmit={h.handleSave} className="space-y-3">
                <div>
                    <label className="block text-sm text-secondary mb-1">Steam Web API Key</label>
                    <PasswordInput id="steamApiKey" value={h.apiKey} onChange={h.setApiKey}
                        placeholder={isConfigured ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'Enter your Steam API key'}
                        showPassword={h.showKey} onToggleShow={() => h.setShowKey(!h.showKey)} />
                    <p className="mt-1 text-xs text-muted">
                        Get your free API key from{' '}
                        <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">steamcommunity.com/dev/apikey</a>
                    </p>
                </div>
                <button type="submit" disabled={!h.apiKey.trim() || h.isPending.save}
                    className="px-4 py-2 text-sm bg-accent hover:bg-accent/80 disabled:bg-accent/30 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors">
                    {h.isPending.save ? 'Saving...' : 'Save API Key'}
                </button>
            </form>
        </div>
    );
}
