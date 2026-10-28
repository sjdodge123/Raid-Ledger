/**
 * ROK-1965 — "Add picture" (approved mockup frames A–C, G): a `FilePicker`
 * (§3, rule: every file upload is one) for one PNG / JPEG / WebP per pick,
 * which uploads at once — no caption step (ruling 4). While uploading it is
 * disabled and reads "Uploading… 40%". `compact` shows "Add" (phone header);
 * the accessible name stays "Add picture" either way.
 */
import type { JSX } from 'react';
import { HUB_MEDIA_UPLOAD_ACCEPT } from '../../../lib/hub-media-upload-copy';
import { FilePicker } from '../../ui/file-picker';
import { useHubGalleryUpload } from './use-hub-gallery-upload';

export interface HubGalleryAddPictureProps {
    guildId: number;
    compact?: boolean;
    /** Lands on the hidden native input (`setInputFiles` in Playwright). */
    inputTestId?: string;
    className?: string;
}

export function HubGalleryAddPicture({ guildId, ...rest }: HubGalleryAddPictureProps): JSX.Element {
    const { upload, uploading, progress } = useHubGalleryUpload(guildId);
    const onFiles = (files: File[]): void => {
        const first = files[0];
        if (first !== undefined) upload(first);
    };
    return <HubGalleryAddPictureView {...rest} uploading={uploading} progress={progress} onFiles={onFiles} />;
}

export interface HubGalleryAddPictureViewProps extends Omit<HubGalleryAddPictureProps, 'guildId'> {
    uploading: boolean;
    progress: number;
    onFiles: (files: File[]) => void;
}

/** The picker itself, state passed in — `/dev/design-system` renders its uploading state. */
export function HubGalleryAddPictureView({
    compact = false, inputTestId = 'hub-gallery-add-picture-input', className, uploading, progress, onFiles,
}: HubGalleryAddPictureViewProps): JSX.Element {
    return (
        <FilePicker accept={HUB_MEDIA_UPLOAD_ACCEPT} onFiles={onFiles} disabled={uploading}
            {...(className !== undefined ? { className } : {})}
            inputProps={{ 'data-testid': inputTestId }}>
            {uploading
                ? <span data-testid="hub-gallery-upload-progress">Uploading… {progress}%</span>
                : <><span aria-hidden="true">＋</span>{compact ? <><span aria-hidden="true">Add</span><span className="sr-only">Add picture</span></> : 'Add picture'}</>}
        </FilePicker>
    );
}
