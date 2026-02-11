import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateTemplateDto } from '@raid-ledger/contract';
import {
    getEventTemplates,
    createEventTemplate,
    deleteEventTemplate,
} from '../lib/api-client';

export function useEventTemplates() {
    return useQuery({
        queryKey: ['event-templates'],
        queryFn: getEventTemplates,
    });
}

export function useCreateTemplate() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (dto: CreateTemplateDto) => createEventTemplate(dto),
        onSuccess: () => {
            toast.success('Template saved');
            queryClient.invalidateQueries({ queryKey: ['event-templates'] });
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to save template');
        },
    });
}

export function useDeleteTemplate() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => deleteEventTemplate(id),
        onSuccess: () => {
            toast.success('Template deleted');
            queryClient.invalidateQueries({ queryKey: ['event-templates'] });
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to delete template');
        },
    });
}
