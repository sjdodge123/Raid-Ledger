/**
 * ROK-1814 — the picker's Upload section (mockup §5: current upload or
 * initials, a `FilePicker`, the limits, the coded error). A pick is staged and
 * previewed in the hero's box; the picker's Save uploads it, Cancel drops it.
 */
import { useEffect, useState, type JSX } from 'react';
import type { GuildCrestEditorState } from '@raid-ledger/contract';
import { FilePicker } from '../../ui/file-picker';
import { HubCrest } from './hub-crest';
import { CREST_UPLOAD_HELP } from './crest-picker-copy';

export { CrestGallerySection } from './crest-picker-gallery';

/** A blob URL for `file` (null without one or where the browser has no `createObjectURL`), revoked on change/unmount. */
function useObjectUrl(file: File | null): string | null {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (file === null || typeof URL.createObjectURL !== 'function') return undefined;
        const next = URL.createObjectURL(file);
        // Lifetime must match this effect (StrictMode-safe revoke), as in useHubMediaImageUrl.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setUrl(next);
        return () => { URL.revokeObjectURL(next); setUrl(null); };
    }, [file]);
    return url;
}

function CrestUploadPreview({ state, name, staged }: { state: GuildCrestEditorState; name: string; staged: File | null }): JSX.Element {
    const url = useObjectUrl(staged);
    if (staged !== null && url !== null) {
        return <img src={url} alt="" className="h-16 w-16 shrink-0 rounded-xl border-2 border-edge-strong object-cover sm:h-20 sm:w-20" data-testid="crest-upload-preview" />;
    }
    const crest = state.upload ? { source: 'upload' as const, ...state.upload } : null;
    return <HubCrest crest={crest} name={name} size="hero" />;
}

interface CrestUploadSectionProps {
    state: GuildCrestEditorState;
    name: string;
    staged: File | null;
    uploading: boolean;
    error: string | null;
    onFile: (file: File) => void;
}

export function CrestUploadSection({ state, name, staged, uploading, error, onFile }: CrestUploadSectionProps): JSX.Element {
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-4 rounded-lg border border-dashed border-edge-strong p-4">
                <CrestUploadPreview state={state} name={name} staged={staged} />
                <div className="min-w-0">
                    <FilePicker
                        accept="image/png,image/jpeg,image/webp" variant="secondary" loading={uploading} loadingLabel="Uploading…"
                        onFiles={(files) => { const file = files[0]; if (file) onFile(file); }}
                        inputProps={{ 'data-testid': 'crest-upload-input' }}
                    >
                        {staged === null ? 'Choose image' : 'Choose another image'}
                    </FilePicker>
                    {staged !== null && <p className="mt-1.5 truncate text-xs text-secondary" data-testid="crest-upload-staged">Save to use {staged.name}</p>}
                    <p className="mt-1.5 text-xs text-muted">{CREST_UPLOAD_HELP}</p>
                </div>
            </div>
            {error && <p role="alert" className="text-sm text-danger" data-testid="crest-upload-error">{error}</p>}
        </div>
    );
}
