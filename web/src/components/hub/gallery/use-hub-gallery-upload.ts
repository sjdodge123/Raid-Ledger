/**
 * ROK-1965 — one Gallery upload: shrink the pick if it is over the cap, POST it,
 * then refresh every Gallery query for the hub (strip, card probe, dialog pages)
 * so the new picture shows first. Toasts "Picture added", the duplicate note, or
 * the error's plain copy. The shrink step and the schema-bound client load on
 * demand — this hook sits in the eagerly loaded card header.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hubMediaKeys } from '../../../lib/hub-media-query';
import {
    HUB_MEDIA_UPLOAD_DUPLICATE,
    HUB_MEDIA_UPLOAD_SUCCESS,
    hubMediaUploadErrorCopy,
} from '../../../lib/hub-media-upload-copy';
import { toast } from '../../../lib/toast';

async function shrinkAndUpload(guildId: number, file: File, onProgress: (percent: number) => void) {
    const [{ shrinkForUpload }, { uploadHubMedia }] = await Promise.all([
        import('../../../lib/hub-media-shrink'),
        import('../../../lib/hub-media-upload-api'),
    ]);
    return uploadHubMedia(guildId, await shrinkForUpload(file), onProgress);
}

export interface HubGalleryUpload {
    upload: (file: File) => void;
    uploading: boolean;
    /** 0–100 while uploading. */
    progress: number;
}

export function useHubGalleryUpload(guildId: number): HubGalleryUpload {
    const qc = useQueryClient();
    const [progress, setProgress] = useState(0);
    const mutation = useMutation({
        mutationFn: (file: File) => shrinkAndUpload(guildId, file, setProgress),
        onMutate: () => setProgress(0),
        onSuccess: async ({ duplicate }) => {
            await qc.invalidateQueries({ queryKey: hubMediaKeys.all(guildId) });
            if (duplicate) toast.info(HUB_MEDIA_UPLOAD_DUPLICATE);
            else toast.success(HUB_MEDIA_UPLOAD_SUCCESS);
        },
        onError: (err) => toast.error(hubMediaUploadErrorCopy(err)),
    });
    return { upload: (file) => mutation.mutate(file), uploading: mutation.isPending, progress };
}
