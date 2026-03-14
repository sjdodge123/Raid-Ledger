interface AiFeatureTogglesProps {
    disabled: boolean;
}

/** Toggle for a single AI feature. */
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
        <div className="flex items-center justify-between py-2">
            <div>
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted">{description}</p>
            </div>
            <button
                type="button"
                role="switch"
                aria-checked={enabled}
                disabled={disabled}
                onClick={() => onChange(!enabled)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                    enabled ? 'bg-purple-600' : 'bg-overlay'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
                <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-foreground transition-transform ${
                        enabled ? 'translate-x-5' : ''
                    }`}
                />
            </button>
        </div>
    );
}

/**
 * Toggle switches for AI feature flags.
 * Disabled when the provider is offline.
 */
export function AiFeatureToggles({ disabled }: AiFeatureTogglesProps) {
    return (
        <div className="space-y-1 divide-y divide-edge/50">
            <FeatureToggle
                label="AI Chat"
                description="Enable AI chat assistant for community members"
                enabled={false}
                disabled={disabled}
                onChange={() => {}}
            />
            <FeatureToggle
                label="Dynamic Categories"
                description="Use AI to suggest event categories"
                enabled={false}
                disabled={disabled}
                onChange={() => {}}
            />
        </div>
    );
}
