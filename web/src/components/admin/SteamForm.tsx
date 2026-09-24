import { useState } from 'react';
import { toast } from '../../lib/toast';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { PasswordInput, TestResultBanner } from './admin-form-helpers';

function SteamSetupInstructions() {
    return (
        <div className="bg-overlay/30 border border-edge rounded-lg p-4 mb-6">
            <p className="text-sm text-foreground"><strong>Setup Instructions:</strong></p>
            <ol className="text-sm text-secondary mt-2 space-y-1 list-decimal list-inside">
                <li>Go to <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">steamcommunity.com/dev/apikey</a></li>
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
            <Button type="submit" variant="primary" size="lg" className="flex-1"
                loading={isPending.save} loadingLabel="Saving...">
                Save Configuration
            </Button>
            {configured && (
                <>
                    <Button variant="secondary" size="lg" onClick={onTest} loading={isPending.test} loadingLabel="Testing...">
                        Test Connection
                    </Button>
                    <Button variant="destructive-soft" size="lg" onClick={onClear} loading={isPending.clear}>
                        Clear
                    </Button>
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
                <Field id="steamApiKey" label="Steam Web API Key">
                    <PasswordInput id="steamApiKey" value={h.apiKey} onChange={h.setApiKey}
                        placeholder={placeholder}
                        showPassword={h.showKey} onToggleShow={() => h.setShowKey(!h.showKey)}
                        fieldLabel="API key" />
                </Field>
                <TestResultBanner result={h.testResult} />
                <SteamActionButtons configured={isConfigured} isPending={h.isPending}
                    onTest={h.handleTest} onClear={h.handleClear} />
            </form>
        </>
    );
}
