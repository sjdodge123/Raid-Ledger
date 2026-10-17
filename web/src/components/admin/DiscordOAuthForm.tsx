import { useState, useMemo } from 'react';
import { toast } from '../../lib/toast';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { API_BASE_URL } from '../../lib/config';
import { Field } from '../ui/field';
import { PasswordInput, TestResultBanner, CopyableInput, FormTextField } from './admin-form-helpers';
import { IntegrationFormActions } from './integration-form-actions';

function SetupInstructions() {
    return (
        <div className="bg-overlay/30 border border-edge rounded-lg p-4 mb-6">
            <p className="text-sm text-foreground"><strong>Setup Instructions:</strong></p>
            <ol className="text-sm text-secondary mt-2 space-y-1 list-decimal list-inside">
                <li>Go to <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">Discord Developer Portal</a></li>
                <li>Create or select an application</li>
                <li>Go to OAuth2 &rarr; Copy Client ID and Client Secret</li>
                <li>Add redirect URL to OAuth2 &rarr; Redirects</li>
            </ol>
        </div>
    );
}

function buildCallbackUrl() {
    const apiPath = API_BASE_URL.startsWith('/') ? API_BASE_URL : '';
    if (apiPath) return `${window.location.origin}${apiPath}/auth/discord/callback`;
    return `${API_BASE_URL}/auth/discord/callback`;
}

function CallbackUrlsSection({ callbackUrl, linkCallbackUrl }: { callbackUrl: string; linkCallbackUrl: string }) {
    return (
        <div>
            <label className="block text-sm font-medium text-secondary mb-1.5">
                <>Callback URLs <span className="text-dim">(add both to Discord)</span></>
            </label>
            <div className="mb-2">
                <CopyableInput value={callbackUrl} onCopied="Callback URL copied!" label="Callback URL" />
            </div>
            <CopyableInput value={linkCallbackUrl} onCopied="Link callback copied!" label="Link Callback URL" />
            <p className="text-xs text-dim mt-1.5">
                <>Click to copy. Add <strong>both</strong> URLs to Discord &rarr; OAuth2 &rarr; Redirects.</>
            </p>
        </div>
    );
}

function useOAuthFormState() {
    const { oauthStatus, updateOAuth, testOAuth, clearOAuth } = useAdminSettings();
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [showSecret, setShowSecret] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const callbackUrl = useMemo(() => buildCallbackUrl(), []);
    const linkCallbackUrl = useMemo(() => callbackUrl.replace('/callback', '/link/callback'), [callbackUrl]);
    return { oauthStatus, updateOAuth, testOAuth, clearOAuth, clientId, setClientId, clientSecret, setClientSecret, showSecret, setShowSecret, testResult, setTestResult, callbackUrl, linkCallbackUrl };
}

function useOAuthHandlers() {
    const s = useOAuthFormState();

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        s.setTestResult(null);
        if (!s.clientId || !s.clientSecret) { toast.error('Client ID and Client Secret are required'); return; }
        try {
            const r = await s.updateOAuth.mutateAsync({ clientId: s.clientId, clientSecret: s.clientSecret, callbackUrl: s.callbackUrl });
            if (r.success) { toast.success(r.message); s.setClientId(''); s.setClientSecret(''); } else toast.error(r.message);
        } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to save configuration'); }
    };

    const handleTest = async () => {
        s.setTestResult(null);
        try { const r = await s.testOAuth.mutateAsync(); s.setTestResult(r); if (r.success) toast.success(r.message); else toast.error(r.message); }
        catch { toast.error('Failed to test configuration'); }
    };

    const handleClear = async () => {
        if (!confirm('Are you sure you want to clear the Discord OAuth configuration? Users will not be able to login with Discord.')) return;
        try { const r = await s.clearOAuth.mutateAsync(); if (r.success) { toast.success(r.message); s.setTestResult(null); } else toast.error(r.message); }
        catch { toast.error('Failed to clear configuration'); }
    };

    return { ...s, handleSave, handleTest, handleClear,
        isPending: { save: s.updateOAuth.isPending, test: s.testOAuth.isPending, clear: s.clearOAuth.isPending } };
}

export function DiscordOAuthForm() {
    const h = useOAuthHandlers();
    const placeholder = h.oauthStatus.data?.configured ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : undefined;

    return (
        <>
            <SetupInstructions />
            <form onSubmit={h.handleSave} className="space-y-4">
                <FormTextField id="clientId" label="Client ID" value={h.clientId} onChange={h.setClientId}
                    placeholder={placeholder ?? 'Discord Application Client ID'} />
                <Field id="clientSecret" label="Client Secret">
                    <PasswordInput id="clientSecret" value={h.clientSecret} onChange={h.setClientSecret}
                        placeholder={placeholder ?? 'Discord Application Client Secret'}
                        showPassword={h.showSecret} onToggleShow={() => h.setShowSecret(!h.showSecret)} />
                </Field>
                <CallbackUrlsSection callbackUrl={h.callbackUrl} linkCallbackUrl={h.linkCallbackUrl} />
                <TestResultBanner result={h.testResult} />
                <IntegrationFormActions showTest={!!h.oauthStatus.data?.configured}
                    showClear={!!h.oauthStatus.data?.configured} isPending={h.isPending}
                    onTest={h.handleTest} onClear={h.handleClear} />
            </form>
        </>
    );
}
