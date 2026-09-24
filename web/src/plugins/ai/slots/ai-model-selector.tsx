import { useAiModels } from '../../../hooks/admin/use-ai-settings';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/select';

/**
 * Dropdown for selecting the active AI model.
 * Fetches models from the active provider and shows loading/error/empty states.
 */
export function AiModelSelector() {
    const { data: models, isLoading, isError } = useAiModels();

    if (isLoading) return <div className="animate-pulse h-10 bg-surface/50 rounded-lg" />;
    if (isError) return <p className="text-sm text-danger">Failed to load models</p>;
    if (!models || models.length === 0) return <p className="text-sm text-muted">No models found. Pull a model in Ollama first.</p>;
    return (
        <Field label="Active model" id="ai-model">
            <Select fieldSize="lg">
                {models.map((model) => (
                    <option key={model.id} value={model.id}>{model.name}{model.family ? ` (${model.family})` : ''}</option>
                ))}
            </Select>
        </Field>
    );
}
