import { useState } from 'react';
import { toast } from '../../../lib/toast';
import { IntegrationCard } from '../../../components/admin/IntegrationCard';
import { getPluginBadge } from '../../plugin-registry';
import { useAiStatus, useTestAiConnection } from '../../../hooks/admin/use-ai-settings';
import { AiModelSelector } from './ai-model-selector';
import { AiUsageStats } from './ai-usage-stats';
import { AiFeatureToggles } from './ai-feature-toggles';

function OllamaIcon() {
    return (
        <div className="w-10 h-10 rounded-lg bg-[#8B5CF6] flex items-center justify-center text-xl">
            AI
        </div>
    );
}

function HardwareWarning() {
    return (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-4">
            <p className="text-sm text-foreground">
                <strong>Self-Hosted Requirements:</strong>
            </p>
            <ul className="text-sm text-secondary mt-1 list-disc list-inside space-y-0.5">
                <li>Minimum 8GB RAM (16GB recommended)</li>
                <li>Docker with Ollama container running</li>
                <li>Start with: <code className="text-xs bg-surface px-1 rounded">--ai</code> flag</li>
            </ul>
        </div>
    );
}

function TestConnectionButton() {
    const testConnection = useTestAiConnection();
    const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

    const handleTest = async () => {
        setResult(null);
        try {
            const res = await testConnection.mutateAsync();
            setResult(res);
            if (res.success) toast.success(res.message);
            else toast.error(res.message);
        } catch {
            toast.error('Failed to test connection');
        }
    };

    return (
        <div className="space-y-2">
            <button
                type="button"
                onClick={handleTest}
                disabled={testConnection.isPending}
                className="py-2 px-4 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors text-sm"
            >
                {testConnection.isPending ? 'Testing...' : 'Test Connection'}
            </button>
            {result && (
                <TestResult result={result} />
            )}
        </div>
    );
}

function TestResult({ result }: { result: { success: boolean; message: string } }) {
    const cls = result.success
        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
        : 'bg-red-500/10 border-red-500/30 text-red-400';
    return (
        <div className={`p-3 rounded-lg border text-sm ${cls}`}>
            {result.message}
        </div>
    );
}

/**
 * Main admin panel content for the AI plugin.
 * Renders in the admin-settings:plugin-content slot.
 */
export function AiPluginContent({ pluginSlug }: { pluginSlug?: string }) {
    const { data: status, isLoading } = useAiStatus();
    if (pluginSlug && pluginSlug !== 'ai') return null;
    const available = status?.available ?? false;

    return (
        <IntegrationCard
            title="AI Features"
            description="Self-hosted LLM inference via Ollama"
            pluginBadge={getPluginBadge('ai')}
            icon={<OllamaIcon />}
            isConfigured={available}
            isLoading={isLoading}
        >
            <div className="space-y-6">
                <HardwareWarning />
                <TestConnectionButton />
                <AiModelSelector />
                <AiFeatureToggles disabled={!available} />
                <AiUsageStats />
            </div>
        </IntegrationCard>
    );
}
