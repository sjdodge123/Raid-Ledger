import { useId, useState, useMemo } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { WowInstanceDetailDto, WowInstanceDto } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { SearchInput } from '../../../components/ui/search-input';
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

/** "Lv15-21", or "Lv15+" when there is no ceiling. */
function levelRange(min: number, max?: number | null): string {
    return `Lv${min}${max ? `-${max}` : '+'}`;
}

/** Selected-instance chips: fixed 44px chip geometry (design-system §4.3); the Remove target sits flush right. */
function SelectedChips({ instances, onRemove }: { instances: WowInstanceDetailDto[]; onRemove: (id: number) => void }) {
    if (instances.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-2 mb-3">
            {instances.map((inst) => (
                <span key={inst.id} className="inline-flex items-center gap-2 pl-3 min-h-[44px] rounded-full bg-success/10 border border-success/30 text-sm font-medium text-success">
                    {inst.shortName || inst.name}
                    {inst.minimumLevel != null && <span className="text-xs text-muted">{levelRange(inst.minimumLevel, inst.maximumLevel)}</span>}
                    <Button variant="ghost" iconOnly aria-label={`Remove ${inst.name}`} onClick={() => onRemove(inst.id)}>
                        <XMarkIcon className="w-4 h-4" aria-hidden="true" />
                    </Button>
                </span>
            ))}
        </div>
    );
}

function InstanceListItem({ inst, isSelected, isLoading, onToggle }: {
    inst: WowInstanceDto; isSelected: boolean; isLoading: boolean; onToggle: () => void;
}) {
    const range = inst.minimumLevel != null ? ` · ${levelRange(inst.minimumLevel, inst.maximumLevel)}` : '';
    return (
        <div className="px-4">
            <Checkbox label={inst.name} description={isLoading ? 'Loading…' : `${inst.expansion}${range}`}
                checked={isSelected} disabled={isLoading} onChange={onToggle} />
        </div>
    );
}

function InstanceList({ filteredInstances, selectedInstances, loadingInstanceId, onToggle, contentType, contentSearch, headingId }: {
    filteredInstances: WowInstanceDto[]; selectedInstances: WowInstanceDetailDto[]; loadingInstanceId: number | null;
    onToggle: (inst: WowInstanceDto) => void; contentType: string; contentSearch: string; headingId: string;
}) {
    return (
        <div role="group" aria-labelledby={headingId} className="max-h-48 overflow-y-auto rounded-lg border border-edge bg-panel/50 divide-y divide-edge-subtle">
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

/** The Dungeons/Raids heading; its id names the instance group. */
function ContentHeading({ id, contentType }: { id: string; contentType: 'dungeon' | 'raid' }) {
    return <h4 id={id} className="block text-sm font-medium text-secondary mb-2">{contentType === 'dungeon' ? 'Dungeons' : 'Raids'}</h4>;
}

function UnconfiguredNotice() {
    return (
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
            <p className="text-sm text-warning">Blizzard API not configured — ask an admin to set it up in Plugins.</p>
        </div>
    );
}

export function EventCreateContentBrowser({ wowVariant, contentType, selectedInstances, onInstancesChange }: EventCreateContentBrowserProps) {
    const systemStatus = useSystemStatus();
    const blizzardConfigured = systemStatus.data?.blizzardConfigured ?? true;
    const headingId = useId();
    const [contentSearch, setContentSearch] = useState('');
    const [loadingInstanceId, setLoadingInstanceId] = useState<number | null>(null);
    const { data: instancesData, isLoading: instancesLoading } = useWowInstances(wowVariant, contentType);
    const filteredInstances = useFilteredInstances(instancesData, contentSearch);
    const chips = <SelectedChips instances={selectedInstances} onRemove={(id) => onInstancesChange(selectedInstances.filter((i) => i.id !== id))} />;

    if (!blizzardConfigured) {
        return <div><ContentHeading id={headingId} contentType={contentType} />{chips}<UnconfiguredNotice /></div>;
    }

    return (
        <div>
            <ContentHeading id={headingId} contentType={contentType} />
            {chips}
            <div className="mb-2">
                <SearchInput value={contentSearch} onChange={setContentSearch} label={`Search ${contentType}s`} placeholder={`Search ${contentType}s...`} />
            </div>
            {instancesLoading ? <p className="text-xs text-dim py-2">Loading {contentType}s...</p>
                : <InstanceList filteredInstances={filteredInstances} selectedInstances={selectedInstances} loadingInstanceId={loadingInstanceId}
                    onToggle={(inst) => toggleInstance(inst, selectedInstances, onInstancesChange, contentType, wowVariant, setLoadingInstanceId)}
                    contentType={contentType} contentSearch={contentSearch} headingId={headingId} />}
        </div>
    );
}
