import type { AvailabilityDto } from '@raid-ledger/contract';
import { AvailabilityCard } from './AvailabilityCard';

interface AvailabilityListProps {
    availabilities: AvailabilityDto[];
    onEdit?: (availability: AvailabilityDto) => void;
    onDelete?: (id: string) => void;
    isLoading?: boolean;
}

/**
 * List component for displaying availability windows.
 */
export function AvailabilityList({
    availabilities,
    onEdit,
    onDelete,
    isLoading,
}: AvailabilityListProps) {
    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin" />
            </div>
        );
    }

    if (availabilities.length === 0) {
        return (
            <div className="text-center py-12">
                <svg
                    className="w-12 h-12 mx-auto text-faint mb-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                </svg>
                <p className="text-muted mb-2">No availability windows set</p>
                <p className="text-dim text-sm">
                    Add your availability to help raid leaders schedule events
                </p>
            </div>
        );
    }

    return (
        <div className="grid gap-3">
            {availabilities.map((availability) => (
                <AvailabilityCard
                    key={availability.id}
                    availability={availability}
                    onEdit={onEdit}
                    onDelete={onDelete}
                />
            ))}
        </div>
    );
}
