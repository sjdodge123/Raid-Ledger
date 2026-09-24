import { useState } from 'react';
import { toast } from '../../../lib/toast';
import { IntegrationCard } from '../../../components/admin/IntegrationCard';
import { useAdminSettings } from '../../../hooks/use-admin-settings';
import { useNewBadge } from '../../../hooks/use-new-badge';
import { NewBadge } from '../../../components/ui/new-badge';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { PasswordInput } from '../../../components/ui/password-input';
import { TestResultBanner } from '../../../components/admin/admin-form-helpers';
import { getPluginBadge } from '../../plugin-registry';
import { IntegrationFormActions } from '../../../components/admin/integration-form-actions';

async function handleSave(
    e: React.FormEvent, clientId: string, clientSecret: string,
    updateBlizzard: ReturnType<typeof useAdminSettings>['updateBlizzard'],
    setTestResult: (v: null) => void, resetFields: () => void,
) {
    e.preventDefault(); setTestResult(null);
    if (!clientId || !clientSecret) { toast.error('Client ID and Client Secret are required'); return; }
    try {
        const result = await updateBlizzard.mutateAsync({ clientId, clientSecret });
        if (result.success) { toast.success(result.message); resetFields(); } else { toast.error(result.message); }
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to save configuration'); }
}

async function handleTest(testBlizzard: ReturnType<typeof useAdminSettings>['testBlizzard'], setTestResult: (v: { success: boolean; message: string } | null) => void) {
    setTestResult(null);
    try {
        const result = await testBlizzard.mutateAsync();
        setTestResult(result);
        if (result.success) toast.success(result.message); else toast.error(result.message);
    } catch { toast.error('Failed to test configuration'); }
}

async function handleClear(clearBlizzard: ReturnType<typeof useAdminSettings>['clearBlizzard'], setTestResult: (v: null) => void) {
    if (!confirm('Are you sure you want to clear the Blizzard API configuration? WoW Armory import will be disabled.')) return;
    try {
        const result = await clearBlizzard.mutateAsync();
        if (result.success) { toast.success(result.message); setTestResult(null); } else { toast.error(result.message); }
    } catch { toast.error('Failed to clear configuration'); }
}

const BLIZZARD_ICON_PATH = 'M10.457 0c-.516 2.078-1.11 3.473-2.384 5.105C6.8 6.734 5.53 7.862 3.663 8.944c.563.07 1.097.254 1.097.254s-.453.602-.805 1.398c-.352.796-.555 1.578-.555 1.578s.77-.287 1.563-.399a8.522 8.522 0 0 1 1.867.02s-.164.566-.246 1.309c-.082.743-.07 1.324-.07 1.324s.468-.258 1.082-.457c.613-.2 1.27-.305 1.27-.305s-.063.523-.047 1.172c.016.648.098 1.281.098 1.281s.516-.336 1.008-.586c.492-.25.984-.414.984-.414s.078.43.246 1.016c.168.586.43 1.234.43 1.234s.37-.5.82-.953c.45-.453.926-.785.926-.785s.234.477.582.984c.348.508.719.934.719.934s.219-.434.457-.965c.238-.531.398-.961.398-.961s.48.477.875.738c.395.262.875.5.875.5s-.02-.52.051-1.114c.07-.593.184-1.038.184-1.038s.613.2 1.164.285c.55.086 1.085.102 1.085.102s-.164-.66-.164-1.309c0-.648.066-1.015.066-1.015s.602.168 1.176.25c.574.082 1.094.055 1.094.055s-.156-.703-.387-1.336c-.23-.633-.434-.992-.434-.992s.688.031 1.356-.082c.668-.113 1.242-.336 1.242-.336s-.312-.656-.77-1.273c-.457-.617-.774-.86-.774-.86s.652-.218.98-.413c.329-.195.75-.545.75-.545-1.512-.793-2.73-1.715-3.898-3.168C14.008 3.875 13.258 2.129 12.836 0c-.563 2.64-2.086 4.422-3.805 5.871C7.312 7.32 5.422 8.051 3.21 8.785c2.196.454 3.649 1.793 4.704 3.32 1.055 1.528 1.64 3.524 1.848 5.458l.23-.145s-.118-.652-.118-1.503c0-.852.137-1.86.137-1.86s.437.383.945.688c.508.304.879.414.879.414s-.035-.63.098-1.336c.133-.707.293-1.121.293-1.121s.531.242.934.367c.402.125.886.188.886.188s.02-.535-.008-1.172c-.027-.637-.113-1.172-.113-1.172s.539.11 1.086.152c.547.043 1.093.012 1.093.012s-.136-.59-.363-1.226c-.227-.637-.45-1-.45-1s.606.046 1.184-.063c.578-.11 1.09-.293 1.09-.293s-.266-.598-.645-1.172c-.379-.574-.695-.836-.695-.836s.523-.082 1.047-.254c.523-.172.883-.372.883-.372-1.648-.71-2.75-1.632-3.758-3.058-.434-.613-.786-1.273-1.117-2.097z';

function BlizzardIcon() {
    return (
        <div className="w-10 h-10 rounded-lg bg-[#148EFF] flex items-center justify-center">
            <svg className="w-6 h-6 text-foreground" viewBox="0 0 24 24" fill="currentColor"><path d={BLIZZARD_ICON_PATH} /></svg>
        </div>
    );
}

function SetupInstructions() {
    return (
        <div className="bg-overlay/30 border border-edge rounded-lg p-4 mb-6">
            <p className="text-sm text-foreground"><strong>Setup Instructions:</strong></p>
            <ol className="text-sm text-secondary mt-2 space-y-1 list-decimal list-inside">
                <li>Go to <a href="https://develop.battle.net/access/clients" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">Blizzard Developer Portal</a></li>
                <li>Create or select an API client</li>
                <li>Copy the Client ID and Client Secret</li>
                <li>This enables WoW Armory character import for all users</li>
            </ol>
        </div>
    );
}

function BlizzardConfigForm({ isConfigured, clientId, clientSecret, testResult, onClientIdChange, onClientSecretChange, onSave, onTest, onClear, savePending, testPending, clearPending }: {
    isConfigured: boolean; clientId: string; clientSecret: string;
    testResult: { success: boolean; message: string } | null;
    onClientIdChange: (v: string) => void; onClientSecretChange: (v: string) => void;
    onSave: (e: React.FormEvent) => void; onTest: () => void; onClear: () => void;
    savePending: boolean; testPending: boolean; clearPending: boolean;
}) {
    const placeholder = isConfigured ? '••••••••••••••••••••' : 'Blizzard API';
    return (
        <form onSubmit={onSave} className="space-y-4">
            <Field id="blizzardClientId" label="Client ID">
                <Input type="text" value={clientId} onChange={(e) => onClientIdChange(e.target.value)}
                    placeholder={`${placeholder} Client ID`} fieldSize="lg" />
            </Field>
            <Field id="blizzardClientSecret" label="Client Secret">
                <PasswordInput value={clientSecret} onChange={(e) => onClientSecretChange(e.target.value)}
                    placeholder={`${placeholder} Client Secret`} fieldSize="lg" label="Client Secret" />
            </Field>
            <TestResultBanner result={testResult} />
            <IntegrationFormActions showTest={isConfigured} showClear={isConfigured}
                isPending={{ save: savePending, test: testPending, clear: clearPending }} onTest={onTest} onClear={onClear} />
        </form>
    );
}

export function BlizzardIntegrationSlot({ pluginSlug }: { pluginSlug?: string }) {
    const { blizzardStatus, updateBlizzard, testBlizzard, clearBlizzard } = useAdminSettings();
    const { isNew, markSeen } = useNewBadge('integration-seen:blizzard-api');
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    if (pluginSlug && pluginSlug !== 'blizzard') return null;

    return (
        <IntegrationCard title="Blizzard API" description="Enable WoW Armory character import" pluginBadge={getPluginBadge('blizzard')}
            icon={<BlizzardIcon />} isConfigured={blizzardStatus.data?.configured ?? false} isLoading={blizzardStatus.isLoading}
            badge={<NewBadge visible={isNew} />} onMouseEnter={markSeen}>
            <SetupInstructions />
            <BlizzardConfigForm isConfigured={blizzardStatus.data?.configured ?? false} clientId={clientId} clientSecret={clientSecret}
                testResult={testResult} onClientIdChange={setClientId} onClientSecretChange={setClientSecret}
                onSave={(e) => handleSave(e, clientId, clientSecret, updateBlizzard, setTestResult, () => { setClientId(''); setClientSecret(''); })}
                onTest={() => handleTest(testBlizzard, setTestResult)} onClear={() => handleClear(clearBlizzard, setTestResult)}
                savePending={updateBlizzard.isPending} testPending={testBlizzard.isPending} clearPending={clearBlizzard.isPending} />
        </IntegrationCard>
    );
}
