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
    const [setting, setSetting] = useState(provider.setupInProgress ?? false);

    useEffect(() => {
        if (!setting) return;
        const pollTimer = setInterval(() => {
            void qc.invalidateQueries({ queryKey: ['admin', 'ai', 'providers'] });
        }, 5000);
        return () => { clearInterval(pollTimer); };
    }, [setting, qc]);

    useEffect(() => {
        if (setting && provider.available) {
            setSetting(false);
            toast.success('Ollama is ready');
        }
    }, [setting, provider.available]);

    useEffect(() => {
        if (provider.setupInProgress && !setting) setSetting(true);
        if (!provider.setupInProgress && setting && !provider.available) setSetting(false);
    }, [provider.setupInProgress, setting, provider.available]);

    const handleSetup = async () => {
        setSetting(true);
        setStepIdx(0);
        try {
            await setup.mutateAsync();
        } catch {
            setSetting(false);
            toast.error('Failed to start Ollama setup');
        }
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
                <OllamaBadge provider={provider} setting={setting} />
            </div>
            <p className="text-xs text-muted">Self-hosted LLM inference via Docker</p>
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
    return (
        <div className="flex flex-wrap gap-2">
            {!provider.available && (
                <button type="button" onClick={onSetup}
                    className="py-2 px-4 bg-purple-600 hover:bg-purple-500 text-foreground font-semibold rounded-lg transition-colors text-sm">
                    Setup Ollama
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

function OllamaBadge({ provider, setting }: { provider: AiProviderInfoDto; setting: boolean }) {
    if (setting) return <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 animate-pulse">Setting up...</span>;
    if (provider.active) return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">Active</span>;
    if (provider.available) return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">Running</span>;
    return <span className="text-xs px-2 py-0.5 rounded-full bg-dim/20 text-muted">Offline</span>;
}
