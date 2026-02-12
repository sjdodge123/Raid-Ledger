import { useState, useMemo } from 'react';
import type { WowInstanceDetailDto, WowInstanceDto } from '@raid-ledger/contract';
import { useWowInstances } from '../hooks/use-wow-instances';
import { fetchWowInstanceDetail } from '../api-client';

interface EventCreateContentBrowserProps {
    wowVariant: string;
    contentType: 'dungeon' | 'raid';
    selectedInstances: WowInstanceDetailDto[];
    onInstancesChange: (instances: WowInstanceDetailDto[]) => void;
}

export function EventCreateContentBrowser({
    wowVariant,
    contentType,
    selectedInstances,
    onInstancesChange,
}: EventCreateContentBrowserProps) {
    const [contentSearch, setContentSearch] = useState('');
    const [loadingInstanceId, setLoadingInstanceId] = useState<number | null>(null);

    const { data: instancesData, isLoading: instancesLoading } = useWowInstances(
        wowVariant,
        contentType,
    );

    const filteredInstances = useMemo(() => {
        const allInstances = instancesData?.data ?? [];
        if (!contentSearch.trim()) return allInstances;
        const q = contentSearch.toLowerCase();
        return allInstances.filter(
            (i) =>
                i.name.toLowerCase().includes(q) ||
                i.expansion.toLowerCase().includes(q) ||
                (i.shortName && i.shortName.toLowerCase().includes(q)),
        );
    }, [instancesData?.data, contentSearch]);

    async function handleInstanceToggle(instance: WowInstanceDto) {
        if (selectedInstances.some((i) => i.id === instance.id)) {
            onInstancesChange(selectedInstances.filter((i) => i.id !== instance.id));
            return;
        }

        if (instance.minimumLevel != null) {
            onInstancesChange([...selectedInstances, {
                id: instance.id,
                name: instance.name,
                shortName: instance.shortName,
                expansion: instance.expansion,
                minimumLevel: instance.minimumLevel ?? null,
                maximumLevel: instance.maximumLevel,
                maxPlayers: null,
                category: contentType,
            }]);
            return;
        }

        setLoadingInstanceId(instance.id);
        try {
            const detail = await fetchWowInstanceDetail(instance.id, wowVariant);
            if (instance.shortName && !detail.shortName) {
                detail.shortName = instance.shortName;
            }
            onInstancesChange([...selectedInstances, detail]);
        } catch {
            onInstancesChange([...selectedInstances, {
                id: instance.id,
                name: instance.name,
                shortName: instance.shortName,
                expansion: instance.expansion,
                minimumLevel: null,
                maxPlayers: null,
                category: contentType,
            }]);
        } finally {
            setLoadingInstanceId(null);
        }
    }

    return (
        <div>
            <label className="block text-sm font-medium text-secondary mb-2">
                {contentType === 'dungeon' ? 'Dungeons' : 'Raids'}
            </label>

            {/* Selected chips */}
            {selectedInstances.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                    {selectedInstances.map((inst) => (
                        <span
                            key={inst.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600/20 border border-emerald-500/30 text-xs text-emerald-300"
                        >
                            {inst.shortName || inst.name}
                            {inst.minimumLevel != null && (
                                <span className="text-emerald-500/60">
                                    Lv{inst.minimumLevel}{inst.maximumLevel ? `-${inst.maximumLevel}` : '+'}
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={() => onInstancesChange(selectedInstances.filter((i) => i.id !== inst.id))}
                                className="ml-0.5 text-emerald-400 hover:text-white transition-colors"
                            >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {/* Search input */}
            <input
                type="text"
                value={contentSearch}
                onChange={(e) => setContentSearch(e.target.value)}
                placeholder={`Search ${contentType}s...`}
                className="w-full px-4 py-2.5 bg-panel border border-edge rounded-lg text-foreground placeholder-dim text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors mb-2"
            />

            {/* Instance list */}
            {instancesLoading ? (
                <p className="text-xs text-dim py-2">Loading {contentType}s...</p>
            ) : (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-edge bg-panel/50 divide-y divide-edge-subtle">
                    {filteredInstances.length === 0 ? (
                        <p className="text-xs text-dim px-4 py-3">
                            {contentSearch ? 'No matches found' : `No ${contentType}s available`}
                        </p>
                    ) : (
                        filteredInstances.map((inst) => {
                            const isSelected = selectedInstances.some((i) => i.id === inst.id);
                            const isLoading = loadingInstanceId === inst.id;
                            return (
                                <button
                                    key={inst.id}
                                    type="button"
                                    disabled={isLoading}
                                    onClick={() => handleInstanceToggle(inst)}
                                    className={`w-full flex items-center justify-between px-4 py-2.5 text-left text-sm transition-colors ${
                                        isSelected
                                            ? 'bg-emerald-600/10 text-emerald-300'
                                            : 'text-secondary hover:bg-panel hover:text-foreground'
                                    } ${isLoading ? 'opacity-50' : ''}`}
                                >
                                    <div>
                                        <span className="font-medium">{inst.name}</span>
                                        <span className="ml-2 text-xs text-dim">{inst.expansion}</span>
                                        {inst.minimumLevel != null && (
                                            <span className="ml-2 text-xs text-muted">
                                                Lv{inst.minimumLevel}{inst.maximumLevel ? `-${inst.maximumLevel}` : '+'}
                                            </span>
                                        )}
                                    </div>
                                    {isSelected && (
                                        <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    )}
                                    {isLoading && (
                                        <span className="text-xs text-dim animate-pulse">Loading...</span>
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}
