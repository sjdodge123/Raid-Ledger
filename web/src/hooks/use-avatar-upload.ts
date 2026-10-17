import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uploadAvatar, deleteCustomAvatar } from '../lib/api-client';

function useUploadMutation(queryClient: ReturnType<typeof useQueryClient>, setUploadProgress: (p: number) => void) {
    return useMutation({
        mutationFn: (file: File) => uploadAvatar(file, (percent) => setUploadProgress(percent)),
        onSuccess: () => { setUploadProgress(0); void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }); },
        onError: () => { setUploadProgress(0); },
    });
}

function useDeleteMutation(queryClient: ReturnType<typeof useQueryClient>) {
    return useMutation({
        mutationFn: () => deleteCustomAvatar(),
        onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }); },
    });
}

export function useAvatarUpload() {
    const queryClient = useQueryClient();
    const [uploadProgress, setUploadProgress] = useState(0);
    const uploadMutation = useUploadMutation(queryClient, setUploadProgress);
    const deleteMutation = useDeleteMutation(queryClient);

    return {
        upload: uploadMutation.mutate, uploadAsync: uploadMutation.mutateAsync,
        deleteAvatar: deleteMutation.mutate, deleteAvatarAsync: deleteMutation.mutateAsync,
        isUploading: uploadMutation.isPending, isDeleting: deleteMutation.isPending,
        uploadProgress, uploadError: uploadMutation.error, deleteError: deleteMutation.error,
    };
}
