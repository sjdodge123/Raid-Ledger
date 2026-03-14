import { useState } from 'react';
import { toast } from '../../../lib/toast';
import { useConfigureProvider, useActivateProvider } from '../../../hooks/admin/use-ai-settings';
import type { AiProviderInfoDto } from '@raid-ledger/contract';

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

/** Collapsible setup instructions for a provider. */
function Instructions({ providerKey }: { providerKey: string }) {
    const [open, setOpen] = useState(false);
    const info = PROVIDER_INSTRUCTIONS[providerKey];
    if (!info) return null;

    return (
        <div className="border border-edge/50 rounded-lg overflow-hidden">
            <button type="button" onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs text-secondary hover:text-foreground transition-colors">
                <span>How to get an API key</span>
                <span className="text-muted">{open ? '▲' : '▼'}</span>
            </button>
            {open && (
                <div className="px-3 pb-3 space-y-2">
                    <ol className="list-decimal list-inside space-y-1 text-xs text-muted">
                        {info.steps.map((step, i) => <li key={i}>{step}</li>)}
                    </ol>
                    <a href={info.url} target="_blank" rel="noopener noreferrer"
                        className="inline-block text-xs text-purple-400 hover:text-purple-300 underline">
                        Open {providerKey === 'openai' ? 'OpenAI' : providerKey === 'claude' ? 'Anthropic' : 'Google AI'} Console →
                    </a>
                </div>
            )}
        </div>
    );
}

/** Masked API key input with eye toggle. */
function ApiKeyInput({ value, onChange, show, onToggle }: {
    value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void;
}) {
    return (
        <div className="relative">
            <input
                type={show ? 'text' : 'password'}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="Enter API key"
                className="w-full px-4 py-3 pr-12 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            />
            <button
                type="button"
                onClick={onToggle}
                aria-label={show ? 'Hide API key' : 'Show API key'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
            >
                {show ? 'Hide' : 'Show'}
            </button>
        </div>
    );
}

/** Action buttons for saving and activating a provider. */
function CardActions({ onSave, onActivate, savePending, activePending, isActive, isConfigured }: {
    onSave: () => void; onActivate: () => void;
    savePending: boolean; activePending: boolean; isActive: boolean; isConfigured: boolean;
}) {
    return (
        <div className="flex flex-wrap gap-2 pt-2">
            <button type="button" onClick={onSave} disabled={savePending}
                className="py-2 px-4 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors text-sm">
                {savePending ? 'Saving...' : 'Save'}
            </button>
            {isConfigured && !isActive && (
                <button type="button" onClick={onActivate} disabled={activePending}
                    className="py-2 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors text-sm">
                    {activePending ? 'Activating...' : 'Set as Active'}
                </button>
            )}
        </div>
    );
}

export function CloudProviderCard({ provider }: CloudProviderCardProps) {
    const [apiKey, setApiKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const configure = useConfigureProvider();
    const activate = useActivateProvider();

    const handleSave = async () => {
        if (!apiKey) { toast.error('API key is required'); return; }
        try {
            await configure.mutateAsync({ key: provider.key, apiKey });
            toast.success(`${provider.displayName} configured`);
            setApiKey('');
        } catch { toast.error('Failed to save configuration'); }
    };

    const handleActivate = async () => {
        try {
            await activate.mutateAsync(provider.key);
            toast.success(`${provider.displayName} set as active provider`);
        } catch { toast.error('Failed to activate provider'); }
    };

    return (
        <div className="bg-surface/30 border border-edge rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">{provider.displayName}</h3>
                <ProviderBadge provider={provider} />
            </div>
            <Instructions providerKey={provider.key} />
            <ApiKeyInput value={apiKey} onChange={setApiKey} show={showKey} onToggle={() => setShowKey((v) => !v)} />
            <CardActions
                onSave={handleSave} onActivate={handleActivate}
                savePending={configure.isPending} activePending={activate.isPending}
                isActive={provider.active} isConfigured={provider.configured}
            />
        </div>
    );
}

function ProviderBadge({ provider }: { provider: AiProviderInfoDto }) {
    if (provider.active) return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">Active</span>;
    if (provider.configured) return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">Configured</span>;
    return <span className="text-xs px-2 py-0.5 rounded-full bg-dim/20 text-muted">Not Configured</span>;
}
