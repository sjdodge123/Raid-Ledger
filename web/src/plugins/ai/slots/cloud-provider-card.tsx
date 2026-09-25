import { useId, useState } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import { toast } from '../../../lib/toast';
import { useConfigureProvider, useActivateProvider } from '../../../hooks/admin/use-ai-settings';
import type { AiProviderInfoDto } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { PasswordInput } from '../../../components/ui/password-input';

interface CloudProviderCardProps {
    provider: AiProviderInfoDto;
}

const PROVIDER_INSTRUCTIONS: Record<string, { url: string; steps: string[] }> = {
    openai: {
        url: 'https://platform.openai.com/api-keys',
        steps: [
            'Go to platform.openai.com and sign in (or create an account)',
            'Navigate to API Keys in the left sidebar',
            'Click "Create new secret key"',
            'Copy the key (starts with sk-)',
            'Paste it above and click Save',
        ],
    },
    claude: {
        url: 'https://console.anthropic.com/settings/keys',
        steps: [
            'Go to console.anthropic.com and sign in (or create an account)',
            'Navigate to Settings > API Keys',
            'Click "Create Key"',
            'Copy the key (starts with sk-ant-)',
            'Paste it above and click Save',
        ],
    },
    google: {
        url: 'https://aistudio.google.com/apikey',
        steps: [
            'Go to aistudio.google.com and sign in with your Google account',
            'Click "Get API key" in the top navigation',
            'Click "Create API key" and select a project',
            'Copy the generated key',
            'Paste it above and click Save',
        ],
    },
};

const CONSOLE_NAME: Record<string, string> = { openai: 'OpenAI', claude: 'Anthropic', google: 'Google AI' };

/** Collapsible setup instructions for a provider. */
function Instructions({ providerKey }: { providerKey: string }) {
    const [open, setOpen] = useState(false);
    const panelId = useId();
    const info = PROVIDER_INSTRUCTIONS[providerKey];
    if (!info) return null;

    return (
        <div className="border border-edge/50 rounded-lg overflow-hidden">
            <Button variant="ghost" size="sm" fullWidth aria-expanded={open} aria-controls={panelId}
                onClick={() => setOpen((v) => !v)}>
                How to get an API key
                <ChevronDownIcon className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            </Button>
            {open && (
                <div id={panelId} className="px-3 pb-3 space-y-2">
                    <ol className="list-decimal list-inside space-y-1 text-xs text-muted">
                        {info.steps.map((step, i) => <li key={i}>{step}</li>)}
                    </ol>
                    <a href={info.url} target="_blank" rel="noopener noreferrer"
                        className="inline-block text-xs text-secondary underline hover:text-foreground">
                        Open {CONSOLE_NAME[providerKey] ?? 'Provider'} Console →
                    </a>
                </div>
            )}
        </div>
    );
}

/** The API key field: the shared PasswordInput, toggle named "Show API key" / "Hide API key". */
function ApiKeyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <Field label="API key">
            <PasswordInput label="API key" fieldSize="lg" value={value}
                onChange={(e) => onChange(e.target.value)} placeholder="Enter API key" />
        </Field>
    );
}

/** Action buttons for saving and activating a provider (ruling 10: Set as Active is secondary). */
function CardActions({ onSave, onActivate, savePending, activePending, isActive, isConfigured }: {
    onSave: () => void; onActivate: () => void;
    savePending: boolean; activePending: boolean; isActive: boolean; isConfigured: boolean;
}) {
    return (
        <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="primary" onClick={onSave} loading={savePending} loadingLabel="Saving...">
                Save
            </Button>
            {isConfigured && !isActive && (
                <Button variant="secondary" onClick={onActivate} loading={activePending} loadingLabel="Activating...">
                    Set as Active
                </Button>
            )}
        </div>
    );
}

export function CloudProviderCard({ provider }: CloudProviderCardProps) {
    const [apiKey, setApiKey] = useState('');
    const configure = useConfigureProvider();
    const activate = useActivateProvider();

    const handleSave = async () => {
        if (!apiKey) { toast.error('API key is required'); return; }
        try { await configure.mutateAsync({ key: provider.key, apiKey }); toast.success(`${provider.displayName} configured`); setApiKey(''); }
        catch { toast.error('Failed to save configuration'); }
    };
    const handleActivate = async () => {
        try { await activate.mutateAsync(provider.key); toast.success(`${provider.displayName} set as active provider`); }
        catch { toast.error('Failed to activate provider'); }
    };
    return (
        <div className="bg-surface/30 border border-edge rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">{provider.displayName}</h3>
                <ProviderBadge provider={provider} />
            </div>
            <ProviderError error={provider.error} />
            <Instructions providerKey={provider.key} />
            <ApiKeyInput value={apiKey} onChange={setApiKey} />
            <CardActions onSave={handleSave} onActivate={handleActivate}
                savePending={configure.isPending} activePending={activate.isPending}
                isActive={provider.active} isConfigured={provider.configured} />
        </div>
    );
}

const PILL = 'text-xs px-2 py-0.5 rounded-full';

function ProviderBadge({ provider }: { provider: AiProviderInfoDto }) {
    if (provider.active && provider.available) return <span className={`${PILL} bg-success/10 text-success`}>Active</span>;
    if (provider.active && !provider.available) return <span className={`${PILL} bg-warning/10 text-warning`}>Selected · Offline</span>;
    if (provider.configured) return <span className={`${PILL} bg-overlay text-secondary`}>Configured</span>;
    return <span className={`${PILL} bg-dim/20 text-muted`}>Not Configured</span>;
}

function ProviderError({ error }: { error?: string }) {
    if (!error) return null;
    return <p className="text-xs text-warning bg-warning/10 border border-warning/30 rounded px-2 py-1">{error}</p>;
}
