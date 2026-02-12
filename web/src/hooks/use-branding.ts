import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api-client';
import { toast } from '../lib/toast';

interface BrandingData {
    communityName: string | null;
    communityLogoUrl: string | null;
    communityAccentColor: string | null;
}

/**
 * Fetch branding settings from the admin branding endpoint (ROK-271).
 * This is a public endpoint - no auth required.
 */
async function fetchBranding(): Promise<BrandingData> {
    return fetchApi<BrandingData>('/admin/branding');
}

/**
 * Hook for managing community branding settings (ROK-271).
 */
export function useBranding() {
    const queryClient = useQueryClient();

    const brandingQuery = useQuery({
        queryKey: ['admin', 'branding'],
        queryFn: fetchBranding,
        staleTime: 60_000,
    });

    const updateBranding = useMutation({
        mutationFn: async (data: {
            communityName?: string;
            communityAccentColor?: string;
        }) => {
            return fetchApi<BrandingData>('/admin/branding', {
                method: 'PATCH',
                body: JSON.stringify(data),
            });
        },
        onSuccess: (data: BrandingData) => {
            queryClient.setQueryData(['admin', 'branding'], data);
            void queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
            toast.success('Branding updated');
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to update branding');
        },
    });

    const uploadLogo = useMutation({
        mutationFn: async (file: File) => {
            const formData = new FormData();
            formData.append('logo', file);
            return fetchApi<BrandingData>('/admin/branding/logo', {
                method: 'POST',
                body: formData,
            });
        },
        onSuccess: (data: BrandingData) => {
            queryClient.setQueryData(['admin', 'branding'], data);
            void queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
            toast.success('Logo uploaded');
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to upload logo');
        },
    });

    const resetBranding = useMutation({
        mutationFn: async () => {
            return fetchApi<BrandingData>('/admin/branding/reset', {
                method: 'POST',
            });
        },
        onSuccess: (data: BrandingData) => {
            queryClient.setQueryData(['admin', 'branding'], data);
            void queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
            toast.success('Branding reset to defaults');
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to reset branding');
        },
    });

    return {
        brandingQuery,
        updateBranding,
        uploadLogo,
        resetBranding,
    };
}
