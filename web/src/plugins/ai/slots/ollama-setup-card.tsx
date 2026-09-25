import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '../../../lib/toast';
import {
    useOllamaSetup,
    useOllamaStop,
    useActivateProvider,
} from '../../../hooks/admin/use-ai-settings';
import type { AiProviderInfoDto } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';

interface OllamaSetupCardProps {
    provider: AiProviderInfoDto;
    onSettingChange?: (setting: boolean) => void;
}

const STEP_LABELS: Record<string, { label: string; pct: number }> = {
    downloading_binary: { label: 'Downloading Ollama...', pct: 15 },
    pulling_image: { label: 'Pulling Ollama Docker image...', pct: 25 },
    starting: { label: 'Starting container...', pct: 50 },
    pulling_model: { label: 'Pulling default model (llama3.2:3b)...', pct: 75 },
    ready: { label: 'Almost ready...', pct: 95 },
};
const DEFAULT_STEP = { label: 'Setting up...', pct: 10 };

function useOllamaHandlers(
    setup: ReturnType<typeof useOllamaSetup>, stop: ReturnType<typeof useOllamaStop>,
    activate: ReturnType<typeof useActivateProvider>,
    setLocalSetup: (v: boolean) => void, qc: ReturnType<typeof useQueryClient>,
) {
    const handleSetup = async () => {
        setLocalSetup(true);
        try { const r = await setup.mutateAsync(); if (r && !r.success) { setLocalSetup(false); toast.error(r.message || 'Ollama setup failed'); } }
        catch { setLocalSetup(false); toast.error('Failed to start Ollama setup'); }
    };
    const handleStop = async () => {
        try { await stop.mutateAsync(); toast.success('Ollama stopped'); void qc.invalidateQueries({ queryKey: ['admin', 'ai'] }); }
        catch { toast.error('Failed to stop Ollama'); }
    };
    const handleActivate = async () => {
        try { await activate.mutateAsync('ollama'); toast.success('Ollama set as active provider'); }
        catch { toast.error('Failed to activate Ollama'); }
    };
    return { handleSetup, handleStop, handleActivate };
}

/** Watch provider data for setup completion/error (polling driven by parent query). */
function useOllamaSetupWatcher(
    provider: AiProviderInfoDto, localSetup: boolean,
    setLocalSetup: (v: boolean) => void,
) {
    useEffect(() => {
        if (!localSetup) return;
        if (provider.available) { setLocalSetup(false); toast.success('Ollama is ready'); }
        else if (provider.setupStep === 'error') { setLocalSetup(false); toast.error(provider.error || 'Ollama setup failed'); }
        else if (!provider.setupInProgress) setLocalSetup(false);
    }, [provider.available, provider.setupStep, provider.setupInProgress, provider.error, localSetup, setLocalSetup]);
}

/**
 * Card for Ollama with Docker container management.
 * Shows setup progress, status, and action buttons.
 */
export function OllamaSetupCard({ provider, onSettingChange }: OllamaSetupCardProps) {
    const setup = useOllamaSetup();
    const stop = useOllamaStop();
    const activate = useActivateProvider();
    const qc = useQueryClient();
    const [localSetup, setLocalSetup] = useState(false);
    const setting = localSetup || (provider.setupInProgress ?? false);

    useOllamaSetupWatcher(provider, localSetup, setLocalSetup);
    useEffect(() => { onSettingChange?.(setting); }, [setting, onSettingChange]);
    const { handleSetup, handleStop, handleActivate } = useOllamaHandlers(setup, stop, activate, setLocalSetup, qc);
    return (
        <div className="bg-surface/30 border border-edge rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">{provider.displayName}</h3>
                <OllamaBadge provider={provider} setting={setting} />
            </div>
            <p className="text-xs text-muted">Self-hosted LLM inference via Docker</p>
            {!setting && !provider.available && <OllamaInstructions />}
            {setting && <SetupProgress step={provider.setupStep} />}
            {!setting && <OllamaActions provider={provider}
                onSetup={handleSetup} onStop={handleStop} onActivate={handleActivate}
                stopPending={stop.isPending} activatePending={activate.isPending} />}
        </div>
    );
}

function SetupProgress({ step }: { step?: string }) {
    const info = (step && STEP_LABELS[step]) || DEFAULT_STEP;
    return (
        <div className="space-y-2">
            <div className="h-2 bg-dim/30 rounded-full overflow-hidden" role="progressbar"
                aria-label="Ollama setup progress" aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={info.pct} aria-valuetext={info.label}>
                <div className="h-full bg-success rounded-full transition-all duration-1000"
                    style={{ width: `${info.pct}%` }} />
            </div>
            <p className="text-xs text-secondary animate-pulse">{info.label}</p>
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
            {needsSetup && <Button variant="primary" onClick={onSetup}>Setup Ollama</Button>}
            {hasContainer && !provider.available && <Button variant="primary" onClick={onSetup}>Start Ollama</Button>}
            {provider.available && (
                <Button variant="destructive-soft" onClick={onStop} loading={stopPending} loadingLabel="Stopping...">Stop</Button>
            )}
            {provider.available && !provider.active && (
                <Button variant="secondary" onClick={onActivate} loading={activatePending} loadingLabel="Activating...">Set as Active</Button>
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
                    <p className="text-xs text-warning">Requires ~4 GB RAM and ~5 GB disk space.</p>
                </div>
            )}
        </div>
    );
}

const PILL = 'text-xs px-2 py-0.5 rounded-full';

function OllamaBadge({ provider, setting }: { provider: AiProviderInfoDto; setting: boolean }) {
    if (setting) return <span className={`${PILL} bg-overlay text-secondary animate-pulse`}>Setting up...</span>;
    if (provider.active && provider.available) return <span className={`${PILL} bg-success/10 text-success`}>Active</span>;
    if (provider.active && !provider.available) return <span className={`${PILL} bg-warning/10 text-warning`}>Selected · Offline</span>;
    if (provider.available) return <span className={`${PILL} bg-overlay text-secondary`}>Running</span>;
    return <span className={`${PILL} bg-dim/20 text-muted`}>Offline</span>;
}
