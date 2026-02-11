import type { WowInstanceDetailDto } from '@raid-ledger/contract';

interface EventDetailContentSectionsProps {
    contentInstances: WowInstanceDetailDto[];
}

/**
 * Renders WoW content instance details in the event detail page.
 * During transition this is consumed via the slot system but the data
 * is already rendered inline in the EventBanner. This component provides
 * a dedicated extension point for future plugin-provided content displays.
 */
export function EventDetailContentSections({
    contentInstances,
}: EventDetailContentSectionsProps) {
    if (contentInstances.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-2">
            {contentInstances.map((inst) => (
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
                </span>
            ))}
        </div>
    );
}
