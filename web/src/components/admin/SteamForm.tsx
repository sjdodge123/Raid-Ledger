import { useState } from 'react';
import { toast } from '../../lib/toast';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { PasswordInput, TestResultBanner } from './admin-form-helpers';

/** Steam brand color for ring/button styling */
const STEAM_RING = 'focus:ring-[#1B2838]';

function SteamSetupInstructions() {
    return (
        <div className="bg-[#1B2838]/30 border border-[#1B2838]/50 rounded-lg p-4 mb-6">
            <p className="text-sm text-foreground"><strong>Setup Instructions:</strong></p>
            <ol className="text-sm text-secondary mt-2 space-y-1 list-decimal list-inside">
                <li>Go to <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-300">steamcommunity.com/dev/apikey</a></li>
                <li>Log in with your Steam account</li>
                <li>Enter a domain name (your Raid Ledger URL) and register for a key</li>
                <li>Copy the API key and paste it below</li>
            </ol>
        </div>
    );
}

function useSteamFormState() {
    const { steamStatus, updateSteam, testSteam, clearSteam } = useAdminSettings();
    const [apiKey, setApiKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    return { steamStatus, updateSteam, testSteam, clearSteam, apiKey, setApiKey, showKey, setShowKey, testResult, setTestResult };
}

function useSteamHandlers() {
    const s = useSteamFormState();

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault(); s.setTestResult(null);
        if (!s.apiKey.trim()) { toast.error('API key is required'); return; }
        try {
            const r = await s.updateSteam.mutateAsync({ apiKey: s.apiKey.trim() });
            if (r.success) { toast.success(r.message); s.setApiKey(''); } else toast.error(r.message);
        } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to save configuration'); }
    };

    const handleTest = async () => {
        s.setTestResult(null);
        try { const r = await s.testSteam.mutateAsync(); s.setTestResult(r); if (r.success) toast.success(r.message); else toast.error(r.message); }
        catch { toast.error('Failed to test configuration'); }
    };

    const handleClear = async () => {
        try { const r = await s.clearSteam.mutateAsync(); toast.success(r.message); s.setTestResult(null); }
        catch { toast.error('Failed to clear configuration'); }
    };

    return { ...s, handleSave, handleTest, handleClear,
        isPending: { save: s.updateSteam.isPending, test: s.testSteam.isPending, clear: s.clearSteam.isPending } };
}

function SteamActionButtons({ configured, isPending, onTest, onClear }: {
    configured: boolean; isPending: { save: boolean; test: boolean; clear: boolean };
    onTest: () => void; onClear: () => void;
}) {
    return (
        <div className="flex flex-wrap gap-3 pt-2">
            <button type="submit" disabled={isPending.save}
                className="flex-1 py-3 px-4 bg-[#1B2838] hover:bg-[#2a475e] disabled:bg-[#1B2838]/50 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors">
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

export function SteamForm() {
    const h = useSteamHandlers();
    const isConfigured = h.steamStatus.data?.configured ?? false;
    const placeholder = isConfigured ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'Enter your Steam Web API key';

    return (
        <>
            <SteamSetupInstructions />
            <form onSubmit={h.handleSave} className="space-y-4">
                <div>
                    <label htmlFor="steamApiKey" className="block text-sm font-medium text-secondary mb-1.5">Steam Web API Key</label>
                    <PasswordInput id="steamApiKey" value={h.apiKey} onChange={h.setApiKey}
                        placeholder={placeholder}
                        showPassword={h.showKey} onToggleShow={() => h.setShowKey(!h.showKey)}
                        ringColor={STEAM_RING} fieldLabel="API key" />
                </div>
                <TestResultBanner result={h.testResult} />
                <SteamActionButtons configured={isConfigured} isPending={h.isPending}
                    onTest={h.handleTest} onClear={h.handleClear} />
            </form>
        </>
    );
}
