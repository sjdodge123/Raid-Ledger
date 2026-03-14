import { getPluginBadge } from '../../plugin-registry';
import { IntegrationCard } from '../../../components/admin/IntegrationCard';
import { useAiProviders, useAiStatus } from '../../../hooks/admin/use-ai-settings';
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
    if (!active) return <span className="text-xs text-muted">No active provider</span>;
    return <span className="text-xs text-emerald-400">Active: {active.displayName}</span>;
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
                <AiFeatureToggles disabled={!available} />
                <AiUsageStats />
            </div>
        </IntegrationCard>
    );
}
