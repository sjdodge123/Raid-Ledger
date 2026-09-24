import { useState } from 'react';
import { toast } from '../../lib/toast';
import { useCooptimusSettings } from '../../hooks/admin/use-cooptimus-settings';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { TestResultBanner } from './admin-form-helpers';

function CooptimusSetupInstructions() {
    return (
        <div className="bg-overlay/30 border border-edge rounded-lg p-4 mb-6">
            <p className="text-sm text-foreground"><strong>Permission-first setup:</strong></p>
            <ol className="text-sm text-secondary mt-2 space-y-1 list-decimal list-inside">
                <li>Co-Optimus&apos;s API is keyless but Cloudflare-gated for unattended clients</li>
                <li>Email them and request an allowlisted user-agent</li>
                <li>Paste the granted user-agent string below</li>
                <li>Use Test to verify access — co-op data then syncs weekly</li>
            </ol>
        </div>
    );
}

/**
 * ROK-1398: editorial-prose opt-in. Defaults OFF — the Co-Optimus grant covers
 * the co-op facts; their "Co-Op Experience" blurb and description are only
 * redistributed once the operator turns this on. Gating is server-side, so the
 * prose is stripped from the API response while this is off.
 */
function useProseToggle() {
    const { cooptimusStatus, setCooptimusProse } = useCooptimusSettings();
    const onChange = async (enabled: boolean) => {
        try {
            const r = await setCooptimusProse.mutateAsync({ enabled });
            if (r.success) toast.success(r.message); else toast.error(r.message);
        } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to update prose setting'); }
    };
    return {
        enabled: cooptimusStatus.data?.proseEnabled ?? false,
        disabled: setCooptimusProse.isPending,
        onChange: (v: boolean) => void onChange(v),
    };
}

function CooptimusProseToggle() {
    const { enabled, disabled, onChange } = useProseToggle();
    return (
        <Checkbox
            id="cooptimus-prose"
            checked={enabled}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
            label="Show editorial prose"
            description={
                <>
                    Renders Co-Optimus&apos;s &quot;The Co-Op Experience&quot; blurb and game description on
                    game detail pages. Leave off unless they have confirmed prose reuse — co-op
                    facts and the attribution credit render either way.
                </>
            }
        />
    );
}

function useCooptimusFormHandlers() {
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

    return { configured, userAgent, setUserAgent, testResult, handleSave, handleTest, handleClear,
        isPending: { save: updateCooptimus.isPending, test: testCooptimus.isPending, clear: clearCooptimus.isPending } };
}

function CooptimusActionButtons({ configured, isPending, onTest, onClear }: {
    configured: boolean; isPending: { save: boolean; test: boolean; clear: boolean };
    onTest: () => void; onClear: () => void;
}) {
    return (
        <div className="flex flex-wrap gap-3 pt-2">
            <Button type="submit" variant="primary" size="lg" className="w-full lg:w-auto lg:flex-1"
                loading={isPending.save} loadingLabel="Saving…">
                Save
            </Button>
            {configured && (
                <>
                    <Button variant="secondary" size="lg" className="whitespace-nowrap" onClick={onTest}
                        loading={isPending.test} loadingLabel="Testing…">
                        Test connection
                    </Button>
                    <Button variant="destructive-soft" size="lg" className="whitespace-nowrap" onClick={onClear}
                        loading={isPending.clear} loadingLabel="Clearing…">
                        Clear
                    </Button>
                </>
            )}
        </div>
    );
}

/** Save / Test / Clear form for the Co-Optimus allowlisted user-agent (ROK-1397). */
export function CooptimusForm() {
    const s = useCooptimusFormHandlers();
    return (
        <form onSubmit={s.handleSave} className="space-y-4">
            <CooptimusSetupInstructions />
            <Field id="cooptimus-ua" label="Allowlisted user-agent">
                <Input
                    type="text"
                    value={s.userAgent}
                    onChange={(e) => s.setUserAgent(e.target.value)}
                    placeholder={s.configured ? 'Configured — enter a new value to replace' : 'e.g. RaidLedger/1.0 (granted-by-cooptimus)'}
                />
            </Field>
            <CooptimusProseToggle />
            <TestResultBanner result={s.testResult} />
            <CooptimusActionButtons configured={s.configured} isPending={s.isPending}
                onTest={s.handleTest} onClear={s.handleClear} />
        </form>
    );
}
