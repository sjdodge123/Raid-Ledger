import { useAiModels } from '../../../hooks/admin/use-ai-settings';

/**
 * Dropdown for selecting the active AI model.
 * Fetches models from the active provider and shows loading/error/empty states.
 */
export function AiModelSelector() {
    const { data: models, isLoading, isError } = useAiModels();

    if (isLoading) return <div className="animate-pulse h-10 bg-surface/50 rounded-lg" />;
    if (isError) return <p className="text-sm text-red-400">Failed to load models</p>;
    if (!models || models.length === 0) return <p className="text-sm text-muted">No models found. Pull a model in Ollama first.</p>;
    return (
        <div>
            <label htmlFor="ai-model" className="block text-sm font-medium text-secondary mb-1.5">Active Model</label>
            <select id="ai-model" className="w-full px-4 py-3 bg-surface/50 border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all">
                {models.map((model) => (
                    <option key={model.id} value={model.id}>{model.name}{model.family ? ` (${model.family})` : ''}</option>
                ))}
            </select>
        </div>
    );
}
