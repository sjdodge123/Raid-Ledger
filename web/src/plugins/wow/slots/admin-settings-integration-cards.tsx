import { useState } from 'react';
import { toast } from '../../../lib/toast';
import { IntegrationCard } from '../../../components/admin/IntegrationCard';
import { useAdminSettings } from '../../../hooks/use-admin-settings';
import { useNewBadge } from '../../../hooks/use-new-badge';
import { NewBadge } from '../../../components/ui/new-badge';
import { getPluginBadge } from '../../plugin-registry';

export function BlizzardIntegrationSlot() {
    const { blizzardStatus, updateBlizzard, testBlizzard, clearBlizzard } = useAdminSettings();
    const { isNew, markSeen } = useNewBadge('integration-seen:blizzard-api');

    const [blizzardClientId, setBlizzardClientId] = useState('');
    const [blizzardClientSecret, setBlizzardClientSecret] = useState('');
    const [showBlizzardSecret, setShowBlizzardSecret] = useState(false);
    const [blizzardTestResult, setBlizzardTestResult] = useState<{ success: boolean; message: string } | null>(null);

    const handleBlizzardSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setBlizzardTestResult(null);

        if (!blizzardClientId || !blizzardClientSecret) {
            toast.error('Client ID and Client Secret are required');
            return;
        }

        try {
            const result = await updateBlizzard.mutateAsync({
                clientId: blizzardClientId,
                clientSecret: blizzardClientSecret,
            });

            if (result.success) {
                toast.success(result.message);
                setBlizzardClientId('');
                setBlizzardClientSecret('');
            } else {
                toast.error(result.message);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to save configuration';
            toast.error(message);
        }
    };

    const handleBlizzardTest = async () => {
        setBlizzardTestResult(null);

        try {
            const result = await testBlizzard.mutateAsync();
            setBlizzardTestResult(result);

            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.message);
            }
        } catch {
            toast.error('Failed to test configuration');
        }
    };

    const handleBlizzardClear = async () => {
        if (!confirm('Are you sure you want to clear the Blizzard API configuration? WoW Armory import will be disabled.')) {
            return;
        }

        try {
            const result = await clearBlizzard.mutateAsync();

            if (result.success) {
                toast.success(result.message);
                setBlizzardTestResult(null);
            } else {
                toast.error(result.message);
            }
        } catch {
            toast.error('Failed to clear configuration');
        }
    };

    const EyeOffIcon = (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
        </svg>
    );
    const EyeIcon = (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </svg>
    );

    const pluginBadge = getPluginBadge('blizzard');

    return (
        <IntegrationCard
            title="Blizzard API"
            description="Enable WoW Armory character import"
            pluginBadge={pluginBadge}
            icon={
                <div className="w-10 h-10 rounded-lg bg-[#148EFF] flex items-center justify-center">
                    <svg className="w-6 h-6 text-foreground" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10.457 0c-.516 2.078-1.11 3.473-2.384 5.105C6.8 6.734 5.53 7.862 3.663 8.944c.563.07 1.097.254 1.097.254s-.453.602-.805 1.398c-.352.796-.555 1.578-.555 1.578s.77-.287 1.563-.399a8.522 8.522 0 0 1 1.867.02s-.164.566-.246 1.309c-.082.743-.07 1.324-.07 1.324s.468-.258 1.082-.457c.613-.2 1.27-.305 1.27-.305s-.063.523-.047 1.172c.016.648.098 1.281.098 1.281s.516-.336 1.008-.586c.492-.25.984-.414.984-.414s.078.43.246 1.016c.168.586.43 1.234.43 1.234s.37-.5.82-.953c.45-.453.926-.785.926-.785s.234.477.582.984c.348.508.719.934.719.934s.219-.434.457-.965c.238-.531.398-.961.398-.961s.48.477.875.738c.395.262.875.5.875.5s-.02-.52.051-1.114c.07-.593.184-1.038.184-1.038s.613.2 1.164.285c.55.086 1.085.102 1.085.102s-.164-.66-.164-1.309c0-.648.066-1.015.066-1.015s.602.168 1.176.25c.574.082 1.094.055 1.094.055s-.156-.703-.387-1.336c-.23-.633-.434-.992-.434-.992s.688.031 1.356-.082c.668-.113 1.242-.336 1.242-.336s-.312-.656-.77-1.273c-.457-.617-.774-.86-.774-.86s.652-.218.98-.413c.329-.195.75-.545.75-.545-1.512-.793-2.73-1.715-3.898-3.168C14.008 3.875 13.258 2.129 12.836 0c-.563 2.64-2.086 4.422-3.805 5.871C7.312 7.32 5.422 8.051 3.21 8.785c2.196.454 3.649 1.793 4.704 3.32 1.055 1.528 1.64 3.524 1.848 5.458l.23-.145s-.118-.652-.118-1.503c0-.852.137-1.86.137-1.86s.437.383.945.688c.508.304.879.414.879.414s-.035-.63.098-1.336c.133-.707.293-1.121.293-1.121s.531.242.934.367c.402.125.886.188.886.188s.02-.535-.008-1.172c-.027-.637-.113-1.172-.113-1.172s.539.11 1.086.152c.547.043 1.093.012 1.093.012s-.136-.59-.363-1.226c-.227-.637-.45-1-.45-1s.606.046 1.184-.063c.578-.11 1.09-.293 1.09-.293s-.266-.598-.645-1.172c-.379-.574-.695-.836-.695-.836s.523-.082 1.047-.254c.523-.172.883-.372.883-.372-1.648-.71-2.75-1.632-3.758-3.058-.434-.613-.786-1.273-1.117-2.097z" />
                    </svg>
                </div>
            }
            isConfigured={blizzardStatus.data?.configured ?? false}
            isLoading={blizzardStatus.isLoading}
            badge={<NewBadge visible={isNew} />}
            onMouseEnter={markSeen}
        >
            {/* Setup Instructions */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
                <p className="text-sm text-foreground">
                    <strong>Setup Instructions:</strong>
                </p>
                <ol className="text-sm text-secondary mt-2 space-y-1 list-decimal list-inside">
                    <li>Go to <a href="https://develop.battle.net/access/clients" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-300">Blizzard Developer Portal</a></li>
                    <li>Create or select an API client</li>
                    <li>Copy the Client ID and Client Secret</li>
                    <li>This enables WoW Armory character import for all users</li>
                </ol>
            </div>

            {/* Configuration Form */}
            <form onSubmit={handleBlizzardSave} className="space-y-4">
                <div>
                    <label htmlFor="blizzardClientId" className="block text-sm font-medium text-secondary mb-1.5">
                        Client ID
                    </label>
                    <input
                        id="blizzardClientId"
                        type="text"
                        value={blizzardClientId}
                        onChange={(e) => setBlizzardClientId(e.target.value)}
                        placeholder={blizzardStatus.data?.configured ? '••••••••••••••••••••' : 'Blizzard API Client ID'}
                        className="w-full px-4 py-3 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                </div>

                <div>
                    <label htmlFor="blizzardClientSecret" className="block text-sm font-medium text-secondary mb-1.5">
                        Client Secret
                    </label>
                    <div className="relative">
                        <input
                            id="blizzardClientSecret"
                            type={showBlizzardSecret ? 'text' : 'password'}
                            value={blizzardClientSecret}
                            onChange={(e) => setBlizzardClientSecret(e.target.value)}
                            placeholder={blizzardStatus.data?.configured ? '••••••••••••••••••••' : 'Blizzard API Client Secret'}
                            className="w-full px-4 py-3 pr-12 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        />
                        <button
                            type="button"
                            onClick={() => setShowBlizzardSecret(!showBlizzardSecret)}
                            aria-label={showBlizzardSecret ? 'Hide password' : 'Show password'}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
                        >
                            {showBlizzardSecret ? EyeOffIcon : EyeIcon}
                        </button>
                    </div>
                </div>

                {/* Test Result */}
                {blizzardTestResult && (
                    <div className={`p-3 rounded-lg animate-[fadeIn_0.3s_ease-in] ${blizzardTestResult.success
                        ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                        : 'bg-red-500/10 border border-red-500/30 text-red-400'
                        }`}>
                        {blizzardTestResult.message}
                    </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-3 pt-2">
                    <button
                        type="submit"
                        disabled={updateBlizzard.isPending}
                        className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors"
                    >
                        {updateBlizzard.isPending ? 'Saving...' : 'Save Configuration'}
                    </button>

                    {blizzardStatus.data?.configured && (
                        <>
                            <button
                                type="button"
                                onClick={handleBlizzardTest}
                                disabled={testBlizzard.isPending}
                                className="py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors"
                            >
                                {testBlizzard.isPending ? 'Testing...' : 'Test Connection'}
                            </button>

                            <button
                                type="button"
                                onClick={handleBlizzardClear}
                                disabled={clearBlizzard.isPending}
                                className="py-3 px-4 bg-red-600/20 hover:bg-red-600/30 text-red-400 font-semibold rounded-lg transition-colors border border-red-600/50"
                            >
                                Clear
                            </button>
                        </>
                    )}
                </div>
            </form>
        </IntegrationCard>
    );
}
