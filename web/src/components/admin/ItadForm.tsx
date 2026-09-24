import { useState } from 'react';
import { toast } from '../../lib/toast';
import { useItadSettings } from '../../hooks/admin/use-itad-settings';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { PasswordInput, TestResultBanner } from './admin-form-helpers';

function ItadSetupInstructions() {
    return (
        <div className="bg-overlay/30 border border-edge rounded-lg p-4 mb-6">
            <p className="text-sm text-foreground"><strong>Setup Instructions:</strong></p>
            <ol className="text-sm text-secondary mt-2 space-y-1 list-decimal list-inside">
                <li>Go to <a href="https://isthereanydeal.com/dev/app/" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">isthereanydeal.com/dev/app</a></li>
                <li>Sign in or create an ITAD account</li>
                <li>Create an application and copy the API key</li>
                <li>Paste the API key below</li>
            </ol>
        </div>
    );
}

function useItadFormState() {
    const { itadStatus, updateItad, testItad, clearItad } = useItadSettings();
    const [apiKey, setApiKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    return { itadStatus, updateItad, testItad, clearItad, apiKey, setApiKey, showKey, setShowKey, testResult, setTestResult };
}

function useItadHandlers() {
    const s = useItadFormState();

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault(); s.setTestResult(null);
        if (!s.apiKey.trim()) { toast.error('API key is required'); return; }
        try {
            const r = await s.updateItad.mutateAsync({ apiKey: s.apiKey.trim() });
            if (r.success) { toast.success(r.message); s.setApiKey(''); } else toast.error(r.message);
        } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to save configuration'); }
    };

    const handleTest = async () => {
        s.setTestResult(null);
        try { const r = await s.testItad.mutateAsync(); s.setTestResult(r); if (r.success) toast.success(r.message); else toast.error(r.message); }
        catch { toast.error('Failed to test configuration'); }
    };

    const handleClear = async () => {
        try { const r = await s.clearItad.mutateAsync(); toast.success(r.message); s.setTestResult(null); }
        catch { toast.error('Failed to clear configuration'); }
    };

    return { ...s, handleSave, handleTest, handleClear,
        isPending: { save: s.updateItad.isPending, test: s.testItad.isPending, clear: s.clearItad.isPending } };
}

function ItadActionButtons({ configured, isPending, onTest, onClear }: {
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

export function ItadForm() {
    const h = useItadHandlers();
    const isConfigured = h.itadStatus.data?.configured ?? false;
    const placeholder = isConfigured ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'Enter your ITAD API key';

    return (
        <>
            <ItadSetupInstructions />
            <form onSubmit={h.handleSave} className="space-y-4">
                <Field id="itadApiKey" label="ITAD API Key">
                    <PasswordInput id="itadApiKey" value={h.apiKey} onChange={h.setApiKey}
                        placeholder={placeholder}
                        showPassword={h.showKey} onToggleShow={() => h.setShowKey(!h.showKey)}
                        fieldLabel="API key" />
                </Field>
                <TestResultBanner result={h.testResult} />
                <ItadActionButtons configured={isConfigured} isPending={h.isPending}
                    onTest={h.handleTest} onClear={h.handleClear} />
            </form>
        </>
    );
}
