import { toast } from '../../../lib/toast';
import {
    useOllamaSetup,
    useOllamaStop,
    useActivateProvider,
} from '../../../hooks/admin/use-ai-settings';
import type { AiProviderInfoDto } from '@raid-ledger/contract';

interface OllamaSetupCardProps {
    provider: AiProviderInfoDto;
}

/** Action buttons for Ollama container management. */
function OllamaActions({ provider, onSetup, onStop, onActivate, setupPending, stopPending, activatePending }: {
    provider: AiProviderInfoDto;
    onSetup: () => void; onStop: () => void; onActivate: () => void;
    setupPending: boolean; stopPending: boolean; activatePending: boolean;
}) {
    return (
        <div className="flex flex-wrap gap-2">
            {!provider.available && (
                <button type="button" onClick={onSetup} disabled={setupPending}
                    className="py-2 px-4 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors text-sm">
                    {setupPending ? 'Setting up...' : 'Setup Ollama'}
                </button>
            )}
            {provider.available && (
                <button type="button" onClick={onStop} disabled={stopPending}
                    className="py-2 px-4 bg-red-600/20 hover:bg-red-600/30 text-red-400 font-semibold rounded-lg transition-colors text-sm border border-red-600/50">
                    {stopPending ? 'Stopping...' : 'Stop'}
                </button>
            )}
            {provider.available && !provider.active && (
                <button type="button" onClick={onActivate} disabled={activatePending}
                    className="py-2 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors text-sm">
                    {activatePending ? 'Activating...' : 'Set as Active'}
                </button>
            )}
        </div>
    );
}

/**
 * Card for Ollama with Docker container management.
 * Shows status, setup button, stop button, and activate button.
 */
export function OllamaSetupCard({ provider }: OllamaSetupCardProps) {
    const setup = useOllamaSetup();
    const stop = useOllamaStop();
    const activate = useActivateProvider();

    const handleSetup = async () => {
        try {
            const result = await setup.mutateAsync();
            if (result.success) toast.success(result.message);
            else toast.error(result.message);
        } catch { toast.error('Failed to setup Ollama'); }
    };

    const handleStop = async () => {
        try {
            await stop.mutateAsync();
            toast.success('Ollama stopped');
        } catch { toast.error('Failed to stop Ollama'); }
    };

    const handleActivate = async () => {
        try {
            await activate.mutateAsync('ollama');
            toast.success('Ollama set as active provider');
        } catch { toast.error('Failed to activate Ollama'); }
    };

    return (
        <div className="bg-surface/30 border border-edge rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">{provider.displayName}</h3>
                <OllamaBadge provider={provider} />
            </div>
            <p className="text-xs text-muted">Self-hosted LLM inference via Docker</p>
            <OllamaActions
                provider={provider}
                onSetup={handleSetup} onStop={handleStop} onActivate={handleActivate}
                setupPending={setup.isPending} stopPending={stop.isPending} activatePending={activate.isPending}
            />
        </div>
    );
}

/** Status badge for Ollama container. */
function OllamaBadge({ provider }: { provider: AiProviderInfoDto }) {
    if (provider.active) return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">Active</span>;
    if (provider.available) return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">Running</span>;
    return <span className="text-xs px-2 py-0.5 rounded-full bg-dim/20 text-muted">Offline</span>;
}
