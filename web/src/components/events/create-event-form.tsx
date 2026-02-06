import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { IgdbGameDto, CreateEventDto } from '@raid-ledger/contract';
import { createEvent } from '../../lib/api-client';
import { GameSearchInput } from './game-search-input';
import { TeamAvailabilityPicker } from '../features/heatmap';

interface FormState {
    title: string;
    description: string;
    game: IgdbGameDto | null;
    startDate: string;
    startTime: string;
    endDate: string;
    endTime: string;
}

interface FormErrors {
    title?: string;
    startDate?: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
    datetime?: string;
}

/**
 * Form for creating a new event.
 */
export function CreateEventForm() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    // Form state
    const [form, setForm] = useState<FormState>({
        title: '',
        description: '',
        game: null,
        startDate: '',
        startTime: '',
        endDate: '',
        endTime: '',
    });
    const [errors, setErrors] = useState<FormErrors>({});

    // Create mutation
    const mutation = useMutation({
        mutationFn: createEvent,
        onSuccess: (event) => {
            toast.success('Event created successfully!');
            queryClient.invalidateQueries({ queryKey: ['events'] });
            navigate(`/events/${event.id}`);
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to create event');
        },
    });

    // Validation
    function validate(): boolean {
        const newErrors: FormErrors = {};

        if (!form.title.trim()) {
            newErrors.title = 'Title is required';
        } else if (form.title.length > 200) {
            newErrors.title = 'Title must be 200 characters or less';
        }

        if (!form.startDate) {
            newErrors.startDate = 'Start date is required';
        }
        if (!form.startTime) {
            newErrors.startTime = 'Start time is required';
        }
        if (!form.endDate) {
            newErrors.endDate = 'End date is required';
        }
        if (!form.endTime) {
            newErrors.endTime = 'End time is required';
        }

        // Check if end is after start
        if (form.startDate && form.startTime && form.endDate && form.endTime) {
            const start = new Date(`${form.startDate}T${form.startTime}`);
            const end = new Date(`${form.endDate}T${form.endTime}`);
            if (end <= start) {
                newErrors.datetime = 'End time must be after start time';
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }

    // Handle submit
    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        if (!validate()) return;

        // Build ISO datetime strings
        const startTime = new Date(`${form.startDate}T${form.startTime}`).toISOString();
        const endTime = new Date(`${form.endDate}T${form.endTime}`).toISOString();

        const dto: CreateEventDto = {
            title: form.title.trim(),
            description: form.description.trim() || undefined,
            gameId: form.game?.id,
            startTime,
            endTime,
        };

        mutation.mutate(dto);
    }

    // Update form field
    function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
        setForm((prev) => ({ ...prev, [field]: value }));
        // Clear field error on change
        if (field in errors) {
            setErrors((prev) => ({ ...prev, [field]: undefined, datetime: undefined }));
        }
    }

    // Calculate duration preview
    function getDurationPreview(): string | null {
        if (!form.startDate || !form.startTime || !form.endDate || !form.endTime) {
            return null;
        }
        const start = new Date(`${form.startDate}T${form.startTime}`);
        const end = new Date(`${form.endDate}T${form.endTime}`);
        const diffMs = end.getTime() - start.getTime();
        if (diffMs <= 0) return null;

        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

        if (hours === 0) return `${minutes} min`;
        if (minutes === 0) return `${hours} hr`;
        return `${hours} hr ${minutes} min`;
    }

    const duration = getDurationPreview();

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {/* Title */}
            <div>
                <label htmlFor="title" className="block text-sm font-medium text-slate-300 mb-2">
                    Event Title <span className="text-red-400">*</span>
                </label>
                <input
                    id="title"
                    type="text"
                    value={form.title}
                    onChange={(e) => updateField('title', e.target.value)}
                    placeholder="Weekly Raid Night"
                    maxLength={200}
                    className={`w-full px-4 py-3 bg-slate-800 border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${errors.title ? 'border-red-500' : 'border-slate-700'
                        }`}
                />
                {errors.title && (
                    <p className="mt-1 text-sm text-red-400">{errors.title}</p>
                )}
            </div>

            {/* Description */}
            <div>
                <label htmlFor="description" className="block text-sm font-medium text-slate-300 mb-2">
                    Description
                </label>
                <textarea
                    id="description"
                    value={form.description}
                    onChange={(e) => updateField('description', e.target.value)}
                    placeholder="Add details about this event..."
                    maxLength={2000}
                    rows={4}
                    className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors resize-none"
                />
            </div>

            {/* Game Search */}
            <GameSearchInput
                value={form.game}
                onChange={(game) => updateField('game', game)}
            />

            {/* Date/Time Section */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Start Date */}
                <div>
                    <label htmlFor="startDate" className="block text-sm font-medium text-slate-300 mb-2">
                        Start Date <span className="text-red-400">*</span>
                    </label>
                    <input
                        id="startDate"
                        type="date"
                        value={form.startDate}
                        onChange={(e) => updateField('startDate', e.target.value)}
                        className={`w-full px-4 py-3 bg-slate-800 border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${errors.startDate ? 'border-red-500' : 'border-slate-700'
                            }`}
                    />
                    {errors.startDate && (
                        <p className="mt-1 text-sm text-red-400">{errors.startDate}</p>
                    )}
                </div>

                {/* Start Time */}
                <div>
                    <label htmlFor="startTime" className="block text-sm font-medium text-slate-300 mb-2">
                        Start Time <span className="text-red-400">*</span>
                    </label>
                    <input
                        id="startTime"
                        type="time"
                        value={form.startTime}
                        onChange={(e) => updateField('startTime', e.target.value)}
                        className={`w-full px-4 py-3 bg-slate-800 border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${errors.startTime ? 'border-red-500' : 'border-slate-700'
                            }`}
                    />
                    {errors.startTime && (
                        <p className="mt-1 text-sm text-red-400">{errors.startTime}</p>
                    )}
                </div>

                {/* End Date */}
                <div>
                    <label htmlFor="endDate" className="block text-sm font-medium text-slate-300 mb-2">
                        End Date <span className="text-red-400">*</span>
                    </label>
                    <input
                        id="endDate"
                        type="date"
                        value={form.endDate}
                        onChange={(e) => updateField('endDate', e.target.value)}
                        className={`w-full px-4 py-3 bg-slate-800 border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${errors.endDate ? 'border-red-500' : 'border-slate-700'
                            }`}
                    />
                    {errors.endDate && (
                        <p className="mt-1 text-sm text-red-400">{errors.endDate}</p>
                    )}
                </div>

                {/* End Time */}
                <div>
                    <label htmlFor="endTime" className="block text-sm font-medium text-slate-300 mb-2">
                        End Time <span className="text-red-400">*</span>
                    </label>
                    <input
                        id="endTime"
                        type="time"
                        value={form.endTime}
                        onChange={(e) => updateField('endTime', e.target.value)}
                        className={`w-full px-4 py-3 bg-slate-800 border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${errors.endTime ? 'border-red-500' : 'border-slate-700'
                            }`}
                    />
                    {errors.endTime && (
                        <p className="mt-1 text-sm text-red-400">{errors.endTime}</p>
                    )}
                </div>
            </div>

            {/* Duration Preview */}
            {duration && (
                <div className="text-sm text-slate-400">
                    Duration: <span className="text-emerald-400 font-medium">{duration}</span>
                </div>
            )}

            {/* Datetime Error */}
            {errors.datetime && (
                <p className="text-sm text-red-400">{errors.datetime}</p>
            )}

            {/* Your Availability (ROK-182) */}
            {form.startDate && form.startTime && form.endDate && form.endTime && (
                <TeamAvailabilityPicker
                    eventStartTime={new Date(`${form.startDate}T${form.startTime}`).toISOString()}
                    eventEndTime={new Date(`${form.endDate}T${form.endTime}`).toISOString()}
                    gameId={form.game?.id?.toString()}
                />
            )}

            {/* Submit */}
            <div className="flex items-center justify-end gap-4 pt-4">
                <button
                    type="button"
                    onClick={() => navigate('/events')}
                    className="px-6 py-3 text-slate-300 hover:text-white font-medium transition-colors"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={mutation.isPending}
                    className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 text-white font-semibold rounded-lg transition-colors"
                >
                    {mutation.isPending ? 'Creating...' : 'Create Event'}
                </button>
            </div>
        </form>
    );
}
