import { useState, useMemo } from 'react';
import type { WowInstanceDetailDto, WowInstanceDto } from '@raid-ledger/contract';
import { useWowInstances } from '../hooks/use-wow-instances';
import { fetchWowInstanceDetail } from '../api-client';
import { useSystemStatus } from '../../../hooks/use-system-status';

interface EventCreateContentBrowserProps {
    wowVariant: string;
    contentType: 'dungeon' | 'raid';
    selectedInstances: WowInstanceDetailDto[];
    onInstancesChange: (instances: WowInstanceDetailDto[]) => void;
}

function buildBasicInstanceDetail(instance: WowInstanceDto, contentType: 'dungeon' | 'raid'): WowInstanceDetailDto {
    return {
        id: instance.id, name: instance.name, shortName: instance.shortName,
        expansion: instance.expansion, minimumLevel: instance.minimumLevel ?? null,
        maximumLevel: instance.maximumLevel, maxPlayers: null, category: contentType,
    };
}

async function toggleInstance(
    instance: WowInstanceDto, selectedInstances: WowInstanceDetailDto[],
    onInstancesChange: (i: WowInstanceDetailDto[]) => void,
    contentType: 'dungeon' | 'raid', wowVariant: string,
    setLoadingId: (id: number | null) => void,
) {
    if (selectedInstances.some((i) => i.id === instance.id)) {
        onInstancesChange(selectedInstances.filter((i) => i.id !== instance.id)); return;
    }
    if (instance.minimumLevel != null) {
        onInstancesChange([...selectedInstances, buildBasicInstanceDetail(instance, contentType)]); return;
    }
    setLoadingId(instance.id);
    try {
        const detail = await fetchWowInstanceDetail(instance.id, wowVariant);
        if (instance.shortName && !detail.shortName) detail.shortName = instance.shortName;
        onInstancesChange([...selectedInstances, detail]);
    } catch {
        onInstancesChange([...selectedInstances, { ...buildBasicInstanceDetail(instance, contentType), minimumLevel: null }]);
    } finally { setLoadingId(null); }
}

function SelectedChips({ instances, onRemove }: { instances: WowInstanceDetailDto[]; onRemove: (id: number) => void }) {
    if (instances.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-2 mb-3">
            {instances.map((inst) => (
                <span key={inst.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600/20 border border-emerald-500/30 text-xs text-emerald-300">
                    {inst.shortName || inst.name}
                    {inst.minimumLevel != null && <span className="text-emerald-500/60">Lv{inst.minimumLevel}{inst.maximumLevel ? `-${inst.maximumLevel}` : '+'}</span>}
                    <button type="button" onClick={() => onRemove(inst.id)} className="ml-0.5 text-emerald-400 hover:text-white transition-colors">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </span>
            ))}
        </div>
    );
}

function InstanceListItem({ inst, isSelected, isLoading, onToggle }: {
    inst: WowInstanceDto; isSelected: boolean; isLoading: boolean; onToggle: () => void;
}) {
    return (
        <button key={inst.id} type="button" disabled={isLoading} onClick={onToggle}
            className={`w-full flex items-center justify-between px-4 py-2.5 text-left text-sm transition-colors ${isSelected ? 'bg-emerald-600/10 text-emerald-300' : 'text-secondary hover:bg-panel hover:text-foreground'} ${isLoading ? 'opacity-50' : ''}`}>
            <div>
                <span className="font-medium">{inst.name}</span>
                <span className="ml-2 text-xs text-dim">{inst.expansion}</span>
                {inst.minimumLevel != null && <span className="ml-2 text-xs text-muted">Lv{inst.minimumLevel}{inst.maximumLevel ? `-${inst.maximumLevel}` : '+'}</span>}
            </div>
            {isSelected && <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
            {isLoading && <span className="text-xs text-dim animate-pulse">Loading...</span>}
        </button>
    );
}

function InstanceList({ filteredInstances, selectedInstances, loadingInstanceId, onToggle, contentType, contentSearch }: {
    filteredInstances: WowInstanceDto[]; selectedInstances: WowInstanceDetailDto[]; loadingInstanceId: number | null;
    onToggle: (inst: WowInstanceDto) => void; contentType: string; contentSearch: string;
}) {
    return (
        <div className="max-h-48 overflow-y-auto rounded-lg border border-edge bg-panel/50 divide-y divide-edge-subtle">
            {filteredInstances.length === 0 ? (
                <p className="text-xs text-dim px-4 py-3">{contentSearch ? 'No matches found' : `No ${contentType}s available`}</p>
            ) : filteredInstances.map((inst) => (
                <InstanceListItem key={inst.id} inst={inst}
                    isSelected={selectedInstances.some((i) => i.id === inst.id)}
                    isLoading={loadingInstanceId === inst.id} onToggle={() => onToggle(inst)} />
            ))}
        </div>
    );
}

function useFilteredInstances(instancesData: ReturnType<typeof useWowInstances>['data'], contentSearch: string) {
    return useMemo(() => {
        const all = instancesData?.data ?? [];
        if (!contentSearch.trim()) return all;
        const q = contentSearch.toLowerCase();
        return all.filter((i) => i.name.toLowerCase().includes(q) || i.expansion.toLowerCase().includes(q) || (i.shortName && i.shortName.toLowerCase().includes(q)));
    }, [instancesData?.data, contentSearch]);
}

export function EventCreateContentBrowser({ wowVariant, contentType, selectedInstances, onInstancesChange }: EventCreateContentBrowserProps) {
    const systemStatus = useSystemStatus();
    const blizzardConfigured = systemStatus.data?.blizzardConfigured ?? true;
    const [contentSearch, setContentSearch] = useState('');
    const [loadingInstanceId, setLoadingInstanceId] = useState<number | null>(null);
    const { data: instancesData, isLoading: instancesLoading } = useWowInstances(wowVariant, contentType);
    const filteredInstances = useFilteredInstances(instancesData, contentSearch);

    const label = contentType === 'dungeon' ? 'Dungeons' : 'Raids';
    if (!blizzardConfigured) {
        return (
            <div>
                <label className="block text-sm font-medium text-secondary mb-2">{label}</label>
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4"><p className="text-sm text-amber-400">Blizzard API not configured — ask an admin to set it up in Plugins.</p></div>
            </div>
        );
    }

    return (
        <div>
            <label className="block text-sm font-medium text-secondary mb-2">{label}</label>
            <SelectedChips instances={selectedInstances} onRemove={(id) => onInstancesChange(selectedInstances.filter((i) => i.id !== id))} />
            <input type="text" value={contentSearch} onChange={(e) => setContentSearch(e.target.value)} placeholder={`Search ${contentType}s...`}
                className="w-full px-4 py-2.5 bg-panel border border-edge rounded-lg text-foreground placeholder-dim text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors mb-2" />
            {instancesLoading ? <p className="text-xs text-dim py-2">Loading {contentType}s...</p>
                : <InstanceList filteredInstances={filteredInstances} selectedInstances={selectedInstances} loadingInstanceId={loadingInstanceId}
                    onToggle={(inst) => toggleInstance(inst, selectedInstances, onInstancesChange, contentType, wowVariant, setLoadingInstanceId)}
                    contentType={contentType} contentSearch={contentSearch} />}
        </div>
    );
}
