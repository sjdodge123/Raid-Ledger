/**
 * ROK-1814 — the picker's Upload section (mockup §5: current upload or
 * initials, a `FilePicker`, the limits, the coded error) and the Gallery
 * section (operator ruling Q1: pick one of this hub's visible pictures).
 */
import type { JSX } from 'react';
import type { GuildCrestEditorState, HubMediaItem } from '@raid-ledger/contract';
import { FilePicker } from '../../ui/file-picker';
import { useHubMediaImageUrl } from '../../../hooks/use-hub-media-image';
import { useHubGalleryPages } from '../gallery/use-hub-gallery-pages';
import { HubCrest } from './hub-crest';
import { CREST_UPLOAD_HELP } from './crest-picker-copy';

interface CrestUploadSectionProps {
    state: GuildCrestEditorState;
    name: string;
    uploading: boolean;
    error: string | null;
    onFile: (file: File) => void;
}

export function CrestUploadSection({ state, name, uploading, error, onFile }: CrestUploadSectionProps): JSX.Element {
    const crest = state.upload ? { source: 'upload' as const, ...state.upload } : null;
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-4 rounded-lg border border-dashed border-edge-strong p-4">
                <HubCrest crest={crest} name={name} size="hero" />
                <div className="min-w-0">
                    <FilePicker
                        accept="image/png,image/jpeg,image/webp" variant="secondary" loading={uploading} loadingLabel="Uploading…"
                        onFiles={(files) => { const file = files[0]; if (file) onFile(file); }}
                        inputProps={{ 'data-testid': 'crest-upload-input' }}
                    >
                        Choose image
                    </FilePicker>
                    <p className="mt-1.5 text-xs text-muted">{CREST_UPLOAD_HELP}</p>
                </div>
            </div>
            {error && <p role="alert" className="text-sm text-danger" data-testid="crest-upload-error">{error}</p>}
        </div>
    );
}

function GalleryThumb({ item, selected, onPick }: { item: HubMediaItem; selected: boolean; onPick: () => void }): JSX.Element {
    const src = useHubMediaImageUrl(item.thumbPath);
    return (
        <button
            type="button" aria-pressed={selected} aria-label={item.caption ?? `Picture ${item.id}`} onClick={onPick}
            data-testid={`crest-gallery-option-${item.id}`}
            className={`h-20 w-20 overflow-hidden rounded-lg border-2 bg-surface ${selected ? 'border-success' : 'border-edge'}`}
        >
            {src && <img src={src} alt="" className="h-full w-full object-cover" />}
        </button>
    );
}

interface CrestGallerySectionProps {
    guildId: number;
    mediaId: number | null;
    onPick: (id: number) => void;
}

export function CrestGallerySection({ guildId, mediaId, onPick }: CrestGallerySectionProps): JSX.Element {
    const pages = useHubGalleryPages(guildId, 'all');
    const items = pages.items.filter((i) => !i.hidden);
    if (pages.loading) return <p className="text-sm text-muted">Loading the gallery…</p>;
    if (items.length === 0) return <p className="text-sm text-muted" data-testid="crest-gallery-empty">This hub's gallery has no pictures yet.</p>;
    return (
        <div className="flex flex-col gap-2" data-testid="crest-gallery-grid">
            <p className="text-xs text-muted">The picture is copied, cropped square and shown publicly as the crest.</p>
            <div className="flex flex-wrap gap-2">
                {items.map((item) => <GalleryThumb key={item.id} item={item} selected={item.id === mediaId} onPick={() => onPick(item.id)} />)}
            </div>
        </div>
    );
}
