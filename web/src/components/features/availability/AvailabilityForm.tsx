import { useState, useEffect, useMemo } from 'react';
import type { AvailabilityDto, AvailabilityStatus } from '@raid-ledger/contract';
import { useCreateAvailability, useUpdateAvailability } from '../../../hooks/use-availability';
import { toast } from '@/lib/toast';

interface AvailabilityFormProps {
    isOpen: boolean;
    onClose: () => void;
    editingAvailability?: AvailabilityDto | null;
}

const STATUS_OPTIONS: { value: AvailabilityStatus; label: string; description: string }[] = [
    { value: 'available', label: 'Available', description: 'Free during this time' },
    { value: 'committed', label: 'Committed', description: 'Already signed up for an event' },
    { value: 'blocked', label: 'Blocked', description: 'Unavailable (other obligations)' },
    { value: 'freed', label: 'Freed', description: 'Previously blocked, now free' },
];

function formatDateTimeLocal(isoString: string): string {
    const date = new Date(isoString);
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - offset * 60 * 1000);
    return localDate.toISOString().slice(0, 16);
}

function getDefaultTimes(): { start: string; end: string } {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    const start = now.toISOString().slice(0, 16);
    now.setHours(now.getHours() + 2);
    const end = now.toISOString().slice(0, 16);
    return { start, end };
}

/**
 * Modal form for creating/editing availability windows.
 */
export function AvailabilityForm({ isOpen, onClose, editingAvailability }: AvailabilityFormProps) {
    const createMutation = useCreateAvailability();
    const updateMutation = useUpdateAvailability();

    const isEditing = !!editingAvailability;
    const isLoading = createMutation.isPending || updateMutation.isPending;

    // Track a session key to reset form on modal open
    const [sessionKey, setSessionKey] = useState(0);
    const [startTime, setStartTime] = useState('');
    const [endTime, setEndTime] = useState('');
    const [status, setStatus] = useState<AvailabilityStatus>('available');
    const [error, setError] = useState<string | null>(null);

    // Increment session key when modal opens to trigger form reset
    useEffect(() => {
        if (isOpen) {
            setSessionKey((k) => k + 1);
        }
    }, [isOpen]);

    // Compute default values based on editing state
    const defaultValues = useMemo(() => {
        if (editingAvailability) {
            return {
                startTime: formatDateTimeLocal(editingAvailability.timeRange.start),
                endTime: formatDateTimeLocal(editingAvailability.timeRange.end),
                status: editingAvailability.status,
            };
        }
        const defaults = getDefaultTimes();
        return {
            startTime: defaults.start,
            endTime: defaults.end,
            status: 'available' as AvailabilityStatus,
        };
    }, [editingAvailability]);

    // Apply default values when session key changes (modal opens)
    useEffect(() => {
        if (sessionKey > 0) {
            setStartTime(defaultValues.startTime);
            setEndTime(defaultValues.endTime);
            setStatus(defaultValues.status);
            setError(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionKey]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);

        // Validation
        const start = new Date(startTime);
        const end = new Date(endTime);

        if (end <= start) {
            setError('End time must be after start time');
            return;
        }

        const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        if (hours > 24) {
            setError('Availability window cannot exceed 24 hours');
            return;
        }

        try {
            if (isEditing && editingAvailability) {
                const result = await updateMutation.mutateAsync({
                    id: editingAvailability.id,
                    data: {
                        startTime: start.toISOString(),
                        endTime: end.toISOString(),
                        status,
                    },
                });
                if (result.conflicts?.length) {
                    toast.warning(`Updated with ${result.conflicts.length} conflict(s)`);
                } else {
                    toast.success('Availability updated');
                }
            } else {
                const result = await createMutation.mutateAsync({
                    startTime: start.toISOString(),
                    endTime: end.toISOString(),
                    status,
                });
                if (result.conflicts?.length) {
                    toast.warning(`Created with ${result.conflicts.length} conflict(s)`);
                } else {
                    toast.success('Availability added');
                }
            }
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save availability');
        }
    }

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-surface border border-edge rounded-xl w-full max-w-md shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-edge">
                    <h2 className="text-lg font-semibold text-foreground">
                        {isEditing ? 'Edit Availability' : 'Add Availability'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-muted hover:text-foreground transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    {error && (
                        <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    {/* Start Time */}
                    <div>
                        <label className="block text-sm font-medium text-secondary mb-1">
                            Start Time
                        </label>
                        <input
                            type="datetime-local"
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            required
                            className="w-full px-3 py-2 bg-panel border border-edge-strong rounded-lg text-foreground focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                        />
                    </div>

                    {/* End Time */}
                    <div>
                        <label className="block text-sm font-medium text-secondary mb-1">
                            End Time
                        </label>
                        <input
                            type="datetime-local"
                            value={endTime}
                            onChange={(e) => setEndTime(e.target.value)}
                            required
                            className="w-full px-3 py-2 bg-panel border border-edge-strong rounded-lg text-foreground focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                        />
                    </div>

                    {/* Status */}
                    <div>
                        <label className="block text-sm font-medium text-secondary mb-2">
                            Status
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {STATUS_OPTIONS.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => setStatus(option.value)}
                                    className={`p-3 rounded-lg border text-left transition-all ${status === option.value
                                        ? 'bg-emerald-500/20 border-emerald-500 text-foreground'
                                        : 'bg-panel border-edge-strong text-secondary hover:border-dim'
                                        }`}
                                >
                                    <div className="font-medium text-sm">{option.label}</div>
                                    <div className="text-xs text-muted mt-0.5">{option.description}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 bg-overlay hover:bg-faint text-foreground font-medium rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors"
                        >
                            {isLoading ? 'Saving...' : isEditing ? 'Update' : 'Add'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
