import { useState } from 'react';
import { getPluginBadge } from '../../plugin-registry';
import { IntegrationCard } from '../../../components/admin/IntegrationCard';
import { useAiProviders, useAiStatus, useTestChat } from '../../../hooks/admin/use-ai-settings';
import { OllamaSetupCard } from './ollama-setup-card';
import { CloudProviderCard } from './cloud-provider-card';
import { AiFeatureToggles } from './ai-feature-toggles';
import { AiUsageStats } from './ai-usage-stats';
import type { AiProviderInfoDto } from '@raid-ledger/contract';

function AiIcon() {
    return (
        <div className="w-10 h-10 rounded-lg bg-[#8B5CF6] flex items-center justify-center text-xl">
            AI
        </div>
    );
}

/** Active provider indicator shown in the header. */
function ActiveIndicator({ providers }: { providers: AiProviderInfoDto[] }) {
    const active = providers.find((p) => p.active);
    if (!active) return <span className="text-xs text-muted">No provider selected</span>;
    if (!active.available) return <span className="text-xs text-amber-400">{active.displayName} (Offline)</span>;
    return <span className="text-xs text-emerald-400">{active.displayName}</span>;
}

/** Grid of provider cards — Ollama first, then cloud providers. */
function ProviderGrid({ providers }: { providers: AiProviderInfoDto[] }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {providers.map((p) =>
                p.selfHosted
                    ? <OllamaSetupCard key={p.key} provider={p} />
                    : <CloudProviderCard key={p.key} provider={p} />,
            )}
        </div>
    );
}

/**
 * Main admin panel content for the AI plugin.
 * Renders in the admin-settings:plugin-content slot.
 */
export function AiPluginContent({ pluginSlug }: { pluginSlug?: string }) {
    const { data: status, isLoading: statusLoading } = useAiStatus();
    const { data: providers, isLoading: providersLoading } = useAiProviders();

    if (pluginSlug && pluginSlug !== 'ai') return null;

    const available = status?.available ?? false;
    const isLoading = statusLoading || providersLoading;

    return (
        <IntegrationCard
            title="AI Features"
            description="Multi-provider LLM inference"
            pluginBadge={getPluginBadge('ai')}
            icon={<AiIcon />}
            isConfigured={available}
            isLoading={isLoading}
        >
            <div className="space-y-6">
                {providers && providers.length > 0 && (
                    <>
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-medium text-secondary">AI Providers</h3>
                            <ActiveIndicator providers={providers} />
                        </div>
                        <ProviderGrid providers={providers} />
                    </>
                )}
                {available && <TestChatSection />}
                <AiFeatureToggles disabled={!available} />
                <AiUsageStats />
            </div>
        </IntegrationCard>
    );
}

/** Test chat section — sends a test message to the active LLM. */
function TestChatSection() {
    const testChat = useTestChat();
    const [result, setResult] = useState<{ success: boolean; response: string; latencyMs: number } | null>(null);

    const handleTest = async () => {
        setResult(null);
        try {
            const res = await testChat.mutateAsync();
            setResult(res);
        } catch {
            setResult({ success: false, response: 'Request failed', latencyMs: 0 });
        }
    };

    return (
        <div className="space-y-2">
            <h3 className="text-sm font-medium text-secondary">Test LLM</h3>
            <div className="flex items-center gap-3">
                <button type="button" onClick={handleTest} disabled={testChat.isPending}
                    className="py-2 px-4 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 text-foreground font-semibold rounded-lg transition-colors text-sm">
                    {testChat.isPending ? 'Testing...' : 'Send Test Message'}
                </button>
                {result && (
                    <span className={`text-xs ${result.success ? 'text-emerald-400' : 'text-red-400'}`}>
                        {result.latencyMs > 0 ? `${result.latencyMs}ms` : ''}
                    </span>
                )}
            </div>
            {result && (
                <div className={`text-sm p-3 rounded-lg border ${
                    result.success
                        ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300'
                        : 'bg-red-500/5 border-red-500/20 text-red-300'
                }`}>
                    {result.response}
                </div>
            )}
        </div>
    );
}
