import { useState } from 'react';
import { toast } from '../../../lib/toast';
import { useConfigureProvider, useActivateProvider } from '../../../hooks/admin/use-ai-settings';
import type { AiProviderInfoDto } from '@raid-ledger/contract';

interface CloudProviderCardProps {
    provider: AiProviderInfoDto;
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

/** Action buttons for saving, testing, and activating a provider. */
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

/**
 * Reusable card for cloud AI providers (OpenAI, Claude, Google).
 * Shows API key input, save/test/activate buttons, and status badges.
 */
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
            <ApiKeyInput value={apiKey} onChange={setApiKey} show={showKey} onToggle={() => setShowKey((v) => !v)} />
            <CardActions
                onSave={handleSave} onActivate={handleActivate}
                savePending={configure.isPending} activePending={activate.isPending}
                isActive={provider.active} isConfigured={provider.configured}
            />
        </div>
    );
}

/** Status badge showing configured/available/active state. */
function ProviderBadge({ provider }: { provider: AiProviderInfoDto }) {
    if (provider.active) return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">Active</span>;
    if (provider.configured) return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">Configured</span>;
    return <span className="text-xs px-2 py-0.5 rounded-full bg-dim/20 text-muted">Not Configured</span>;
}
