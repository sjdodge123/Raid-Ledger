import { useAiFeatures, useUpdateAiFeatures } from '../../../hooks/admin/use-ai-settings';
import { Switch } from '../../../components/ui/switch';

interface AiFeatureTogglesProps {
    disabled: boolean;
}

/** One AI feature row: label + description beside the shared Switch. */
function FeatureToggle({
    label,
    description,
    enabled,
    disabled,
    onChange,
}: {
    label: string;
    description: string;
    enabled: boolean;
    disabled: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <div className="flex items-center justify-between gap-4 py-2">
            <div>
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted">{description}</p>
            </div>
            <Switch checked={enabled} onChange={onChange} label={label} disabled={disabled} />
        </div>
    );
}

/**
 * Toggle switches for AI feature flags.
 * Reads from GET /admin/ai/features, writes via PUT /admin/ai/features.
 */
export function AiFeatureToggles({ disabled }: AiFeatureTogglesProps) {
    const { data } = useAiFeatures();
    const { mutate } = useUpdateAiFeatures();

    const chatEnabled = data?.chatEnabled ?? false;
    const dynCatEnabled = data?.dynamicCategoriesEnabled ?? false;
    // Default true so an unconfigured install gets the feature; admin
    // must explicitly disable. Mirrors the backend default in
    // ai-admin.controller.getFeatures.
    const aiSuggestionsEnabled = data?.aiSuggestionsEnabled ?? true;

    return (
        <div className="space-y-1 divide-y divide-edge/50">
            <FeatureToggle
                label="AI Chat"
                description="Enable AI chat assistant for community members"
                enabled={chatEnabled}
                disabled={disabled}
                onChange={(v) => mutate({ chatEnabled: v })}
            />
            <FeatureToggle
                label="Dynamic Discovery Categories"
                description="Weekly LLM-proposed rows on the Games discover page (admin-reviewed)"
                enabled={dynCatEnabled}
                disabled={disabled}
                onChange={(v) => mutate({ dynamicCategoriesEnabled: v })}
            />
            <FeatureToggle
                label="AI Nomination Suggestions"
                description="Per-user 'Suggested for you' picks in the Nominate modal and ✨ AI badges on the Common Ground grid. Disable to cap LLM costs."
                enabled={aiSuggestionsEnabled}
                disabled={disabled}
                onChange={(v) => mutate({ aiSuggestionsEnabled: v })}
            />
        </div>
    );
}
