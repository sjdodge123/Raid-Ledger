/**
 * ROK-1814 — the ONLY import path app code uses for the crest picker. The
 * picker (tabs, gallery, upload shrink, swatch radios, Modal/BottomSheet
 * frame) is editor-only, so it is its own chunk, fetched when an editor opens
 * "Change crest" — never part of `hub-page` (guarded by
 * crest-picker-lazy.guard.test.ts). A stale chunk reloads once
 * (`reloadOnChunkError`). The fallback is a tiny inline `aria-busy` status:
 * `CrestPickerLoading` lives in the lazy tree, and the picker shows it itself
 * once its chunk is in while the editor state loads.
 */
import { Suspense, lazy, type JSX } from 'react';
import { reloadOnChunkError } from '../../../lib/chunk-error';
import type { CrestPickerProps } from './crest-picker';

const CrestPicker = lazy(() => reloadOnChunkError(import('./crest-picker')).then((m) => ({ default: m.CrestPicker })));

function ChunkLoading(): JSX.Element {
    return (
        <div role="status" aria-busy="true" data-testid="crest-picker-chunk-loading" className="sr-only">
            Loading the crest picker…
        </div>
    );
}

/** Lazy-loaded {@link CrestPicker}. */
export function LazyCrestPicker(props: CrestPickerProps): JSX.Element {
    return (
        <Suspense fallback={<ChunkLoading />}>
            <CrestPicker {...props} />
        </Suspense>
    );
}
