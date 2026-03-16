import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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

const STEP_LABELS: Record<string, { label: string; pct: number }> = {
    pulling_image: { label: 'Pulling Ollama Docker image...', pct: 25 },
    starting: { label: 'Starting container...', pct: 50 },
    pulling_model: { label: 'Pulling default model (llama3.2:3b)...', pct: 75 },
    ready: { label: 'Almost ready...', pct: 95 },
};
const DEFAULT_STEP = { label: 'Setting up...', pct: 10 };

/**
 * Card for Ollama with Docker container management.
 * Shows setup progress, status, and action buttons.
 */
export function OllamaSetupCard({ provider }: OllamaSetupCardProps) {
    const setup = useOllamaSetup();
    const stop = useOllamaStop();
    const activate = useActivateProvider();
    const qc = useQueryClient();
    const [localSetup, setLocalSetup] = useState(false);
    const setting = localSetup || (provider.setupInProgress ?? false);

    useEffect(() => {
        if (!setting) return;
        const pollTimer = setInterval(async () => {
            await qc.invalidateQueries({ queryKey: ['admin', 'ai', 'providers'] });
            const providers = qc.getQueryData<AiProviderInfoDto[]>(['admin', 'ai', 'providers']);
            const ollama = providers?.find((p) => p.key === 'ollama');
            if (!ollama) return;
            if (ollama.available) {
                setLocalSetup(false);
                toast.success('Ollama is ready');
            } else if (ollama.setupStep === 'error') {
                setLocalSetup(false);
                toast.error(ollama.error || 'Ollama setup failed');
            } else if (!ollama.setupInProgress && localSetup) {
                // Server says setup is not running but we think it is — clear local state
                setLocalSetup(false);
            }
        }, 5000);
        return () => { clearInterval(pollTimer); };
    }, [setting, localSetup, qc]);

    const handleSetup = async () => {
        setLocalSetup(true);
        try {
            const result = await setup.mutateAsync();
            if (result && !result.success) {
                setLocalSetup(false);
                toast.error(result.message || 'Ollama setup failed');
            }
        } catch {
            setLocalSetup(false);
            toast.error('Failed to start Ollama setup');
        }
    };

    const handleStop = async () => {
        try {
            await stop.mutateAsync();
            toast.success('Ollama stopped');
            void qc.invalidateQueries({ queryKey: ['admin', 'ai'] });
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
                <OllamaBadge provider={provider} setting={setting} />
            </div>
            <p className="text-xs text-muted">Self-hosted LLM inference via Docker</p>
            {!setting && !provider.available && <OllamaInstructions />}
            {setting && <SetupProgress step={provider.setupStep} />}
            {!setting && (
                <OllamaActions
                    provider={provider}
                    onSetup={handleSetup} onStop={handleStop} onActivate={handleActivate}
                    stopPending={stop.isPending} activatePending={activate.isPending}
                />
            )}
        </div>
    );
}

function SetupProgress({ step }: { step?: string }) {
    const info = (step && STEP_LABELS[step]) || DEFAULT_STEP;
    return (
        <div className="space-y-2">
            <div className="h-2 bg-dim/30 rounded-full overflow-hidden">
                <div className="h-full bg-purple-500 rounded-full transition-all duration-1000"
                    style={{ width: `${info.pct}%` }} />
            </div>
            <p className="text-xs text-purple-400 animate-pulse">{info.label}</p>
        </div>
    );
}

function OllamaActions({ provider, onSetup, onStop, onActivate, stopPending, activatePending }: {
    provider: AiProviderInfoDto;
    onSetup: () => void; onStop: () => void; onActivate: () => void;
    stopPending: boolean; activatePending: boolean;
}) {
    const hasContainer = provider.setupStep === 'container_exists';
    const needsSetup = !provider.available && !hasContainer;
    return (
        <div className="flex flex-wrap gap-2">
            {needsSetup && (
                <button type="button" onClick={onSetup}
                    className="py-2 px-4 bg-purple-600 hover:bg-purple-500 text-foreground font-semibold rounded-lg transition-colors text-sm">
                    Setup Ollama
                </button>
            )}
            {hasContainer && !provider.available && (
                <button type="button" onClick={onSetup}
                    className="py-2 px-4 bg-blue-600 hover:bg-blue-500 text-foreground font-semibold rounded-lg transition-colors text-sm">
                    Start Ollama
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
                    className="py-2 px-4 bg-emerald-600 hover:bg-emerald-500 text-foreground font-semibold rounded-lg transition-colors text-sm">
                    {activatePending ? 'Activating...' : 'Set as Active'}
                </button>
            )}
        </div>
    );
}

function OllamaInstructions() {
    const [open, setOpen] = useState(false);
    return (
        <div className="border border-edge/50 rounded-lg overflow-hidden">
            <button type="button" onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs text-secondary hover:text-foreground transition-colors">
                <span>Setup instructions</span>
                <span className="text-muted">{open ? '▲' : '▼'}</span>
            </button>
            {open && (
                <div className="px-3 pb-3 space-y-2">
                    <p className="text-xs text-muted">Ollama runs a local LLM on your machine via Docker. No API key needed — everything stays on your server.</p>
                    <ol className="list-decimal list-inside space-y-1 text-xs text-muted">
                        <li>Ensure Docker is installed and running</li>
                        <li>Click "Setup Ollama" above</li>
                        <li>The Docker image (~3 GB) and default model (~2 GB) will be downloaded automatically</li>
                        <li>First setup takes 5-10 minutes depending on your connection</li>
                    </ol>
                    <p className="text-xs text-amber-400/80">Requires ~4 GB RAM and ~5 GB disk space.</p>
                </div>
            )}
        </div>
    );
}

function OllamaBadge({ provider, setting }: { provider: AiProviderInfoDto; setting: boolean }) {
    if (setting) return <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 animate-pulse">Setting up...</span>;
    if (provider.active && provider.available) return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">Active</span>;
    if (provider.active && !provider.available) return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">Selected · Offline</span>;
    if (provider.available) return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">Running</span>;
    return <span className="text-xs px-2 py-0.5 rounded-full bg-dim/20 text-muted">Offline</span>;
}
