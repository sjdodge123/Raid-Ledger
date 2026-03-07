import { useState, useMemo } from 'react';
import { toast } from '../../lib/toast';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { API_BASE_URL } from '../../lib/config';
import { PasswordInput, TestResultBanner, CopyableInput, FormTextField } from './admin-form-helpers';

function SetupInstructions() {
    return (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
            <p className="text-sm text-foreground"><strong>Setup Instructions:</strong></p>
            <ol className="text-sm text-secondary mt-2 space-y-1 list-decimal list-inside">
                <li>Go to <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-100">Discord Developer Portal</a></li>
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
                <CopyableInput value={callbackUrl} onCopied="Callback URL copied!" />
            </div>
            <CopyableInput value={linkCallbackUrl} onCopied="Link callback copied!" />
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
    const callbackUrl = useMemo(buildCallbackUrl, []);
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

function ActionButtons({ configured, isPending, onTest, onClear }: {
    configured: boolean; isPending: { save: boolean; test: boolean; clear: boolean };
    onTest: () => void; onClear: () => void;
}) {
    return (
        <div className="flex flex-wrap gap-3 pt-2">
            <button type="submit" disabled={isPending.save}
                className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors">
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

export function DiscordOAuthForm() {
    const h = useOAuthHandlers();
    const placeholder = h.oauthStatus.data?.configured ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : undefined;

    return (
        <>
            <SetupInstructions />
            <form onSubmit={h.handleSave} className="space-y-4">
                <FormTextField id="clientId" label="Client ID" value={h.clientId} onChange={h.setClientId}
                    placeholder={placeholder ?? 'Discord Application Client ID'} />
                <div>
                    <label htmlFor="clientSecret" className="block text-sm font-medium text-secondary mb-1.5">Client Secret</label>
                    <PasswordInput id="clientSecret" value={h.clientSecret} onChange={h.setClientSecret}
                        placeholder={placeholder ?? 'Discord Application Client Secret'}
                        showPassword={h.showSecret} onToggleShow={() => h.setShowSecret(!h.showSecret)} />
                </div>
                <CallbackUrlsSection callbackUrl={h.callbackUrl} linkCallbackUrl={h.linkCallbackUrl} />
                <TestResultBanner result={h.testResult} />
                <ActionButtons configured={!!h.oauthStatus.data?.configured} isPending={h.isPending}
                    onTest={h.handleTest} onClear={h.handleClear} />
            </form>
        </>
    );
}
