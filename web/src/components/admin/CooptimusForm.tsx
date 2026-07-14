import { useState } from 'react';
import { toast } from '../../lib/toast';
import { useCooptimusSettings } from '../../hooks/admin/use-cooptimus-settings';
import { TestResultBanner } from './admin-form-helpers';

/** Co-Optimus brand blue for ring/button styling */
const COOPTIMUS_RING = 'focus:ring-[#5b9bd5]';

function CooptimusSetupInstructions() {
    return (
        <div className="bg-slate-500/10 border border-slate-500/30 rounded-lg p-4 mb-6">
            <p className="text-sm text-foreground"><strong>Permission-first setup:</strong></p>
            <ol className="text-sm text-secondary mt-2 space-y-1 list-decimal list-inside">
                <li>Co-Optimus&apos;s API is keyless but Cloudflare-gated for unattended clients</li>
                <li>Email them (see the ROK-275 spike) and request an allowlisted user-agent</li>
                <li>Paste the granted user-agent string below</li>
                <li>Use Test to verify access — co-op data then syncs weekly</li>
            </ol>
        </div>
    );
}

/** Save / Test / Clear form for the Co-Optimus allowlisted user-agent (ROK-1397). */
export function CooptimusForm() {
    const { cooptimusStatus, updateCooptimus, testCooptimus, clearCooptimus } = useCooptimusSettings();
    const [userAgent, setUserAgent] = useState('');
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const configured = cooptimusStatus.data?.configured ?? false;

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault(); setTestResult(null);
        if (!userAgent.trim()) { toast.error('User-agent is required'); return; }
        try {
            const r = await updateCooptimus.mutateAsync({ userAgent: userAgent.trim() });
            if (r.success) { toast.success(r.message); setUserAgent(''); } else toast.error(r.message);
        } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to save configuration'); }
    };

    const handleTest = async () => {
        setTestResult(null);
        try { const r = await testCooptimus.mutateAsync(); setTestResult(r); if (r.success) toast.success(r.message); else toast.error(r.message); }
        catch { toast.error('Failed to test configuration'); }
    };

    const handleClear = async () => {
        try { const r = await clearCooptimus.mutateAsync(); toast.success(r.message); setTestResult(null); }
        catch { toast.error('Failed to clear configuration'); }
    };

    return (
        <form onSubmit={handleSave} className="space-y-4">
            <CooptimusSetupInstructions />
            <div>
                <label htmlFor="cooptimus-ua" className="block text-sm font-medium text-secondary mb-1">
                    Allowlisted user-agent
                </label>
                <input
                    id="cooptimus-ua"
                    type="text"
                    value={userAgent}
                    onChange={(e) => setUserAgent(e.target.value)}
                    placeholder={configured ? 'Configured — enter a new value to replace' : 'e.g. RaidLedger/1.0 (granted-by-cooptimus)'}
                    className={`w-full px-3 py-2 bg-backdrop border border-edge rounded-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 ${COOPTIMUS_RING}`}
                />
            </div>
            <TestResultBanner result={testResult} />
            <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={updateCooptimus.isPending}
                    className="px-4 py-2 bg-[#5b9bd5] hover:bg-[#4a8ac4] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                    {updateCooptimus.isPending ? 'Saving…' : 'Save'}
                </button>
                {configured && (
                    <>
                        <button type="button" onClick={handleTest} disabled={testCooptimus.isPending}
                            className="px-4 py-2 bg-surface border border-edge hover:bg-overlay text-foreground text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                            {testCooptimus.isPending ? 'Testing…' : 'Test connection'}
                        </button>
                        <button type="button" onClick={handleClear} disabled={clearCooptimus.isPending}
                            className="px-4 py-2 bg-surface border border-red-500/40 hover:bg-red-500/10 text-red-400 text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                            {clearCooptimus.isPending ? 'Clearing…' : 'Clear'}
                        </button>
                    </>
                )}
            </div>
        </form>
    );
}
