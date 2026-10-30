/**
 * ROK-1814 L6 — the crest editor: a `Modal` at ≥1024 px, a `BottomSheet`
 * below (DS §4.4). A segmented `RadioGroup` picks Upload / Emblem / Gallery /
 * None (Gallery = operator ruling Q1); Save writes the draft. An Upload pick
 * is staged (mockup §5): Save uploads it (the server makes it active), Cancel
 * discards it. Until the editor state loads the frame shows a loading or a
 * load-error body, so "Change crest" never opens nothing.
 */
import type { JSX } from 'react';
import type { GuildCrestEditorState } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { RadioGroup } from '../../ui/radio-group';
import { useGuildCrestEditor, usePickGuildCrestFromGallery, useSetGuildCrest, useUploadGuildCrest } from './use-guild-crest';
import { canRemoveCrestUpload, canSaveCrest, setBodyFor, useCrestDraft, type CrestDraft, type CrestDraftApi, type CrestMode } from './crest-picker-draft';
import { crestErrorMessage, removedNotice } from './crest-picker-copy';
import { CrestPresetSection } from './crest-picker-preset';
import { CrestGallerySection, CrestUploadSection } from './crest-picker-sources';
import { CrestRemoveUpload } from './crest-picker-remove';
import { CrestCancelButton, CrestPickerFrame, CrestPickerLoadError, CrestPickerLoading } from './crest-picker-states';

const MODES: readonly { value: CrestMode; label: string }[] = [
    { value: 'upload', label: 'Upload' }, { value: 'preset', label: 'Emblem' },
    { value: 'gallery', label: 'Gallery' }, { value: 'none', label: 'None' },
];

export interface CrestPickerProps {
    guildId: number;
    name: string;
    onClose: () => void;
    /** `viewer.isStaff` — admins/operators get "Remove upload" on an upload crest (Q7). */
    isStaff?: boolean | undefined;
}

interface LoadedProps extends CrestPickerProps { state: GuildCrestEditorState }

type CrestUpload = ReturnType<typeof useUploadGuildCrest>;

interface CrestSave { save: (draft: CrestDraft) => void; pending: boolean; error: string | null }

/** Save: a staged file uploads, a gallery pick posts its id, everything else `PUT`s. */
function useCrestSave({ guildId, onClose }: CrestPickerProps, upload: CrestUpload): CrestSave {
    const set = useSetGuildCrest(guildId);
    const pick = usePickGuildCrestFromGallery(guildId);
    const failed = set.error ?? pick.error;
    return {
        save: (draft) => {
            const body = setBodyFor(draft);
            if (draft.mode === 'upload' && draft.file !== null) upload.mutate(draft.file, { onSuccess: onClose });
            else if (body) set.mutate(body, { onSuccess: onClose });
            else if (draft.mediaId !== null) pick.mutate(draft.mediaId, { onSuccess: onClose });
        },
        pending: set.isPending || pick.isPending || upload.isPending,
        error: failed ? crestErrorMessage(failed) : null,
    };
}

function PickerBody({ state, guildId, name, isStaff = false, api, upload }: LoadedProps & { api: CrestDraftApi; upload: CrestUpload }): JSX.Element {
    const { draft } = api;
    return (
        <div className="flex flex-col gap-4" data-testid="crest-picker">
            {state.removedByStaffAt && <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning" data-testid="crest-removed-notice">{removedNotice(state.removedByStaffAt)}</p>}
            <RadioGroup label="Crest type" hideLabel appearance="segmented" options={MODES} value={draft.mode} onChange={api.setMode} />
            {draft.mode === 'upload' && <CrestUploadSection state={state} name={name} staged={draft.file} uploading={upload.isPending} error={upload.error ? crestErrorMessage(upload.error) : null} onFile={api.setFile} />}
            {draft.mode === 'upload' && canRemoveCrestUpload(state, isStaff) && <CrestRemoveUpload guildId={guildId} />}
            {draft.mode === 'preset' && <CrestPresetSection preset={draft.preset} name={name} onChange={api.setPreset} />}
            {draft.mode === 'gallery' && <CrestGallerySection guildId={guildId} mediaId={draft.mediaId} onPick={api.setMediaId} />}
            {draft.mode === 'none' && <p className="text-sm text-muted">The hub shows its initials. Your stored crest is kept, so you can switch back.</p>}
        </div>
    );
}

function LoadedPicker(props: LoadedProps): JSX.Element {
    const api = useCrestDraft(props.state);
    const upload = useUploadGuildCrest(props.guildId);
    const { save, pending, error } = useCrestSave(props, upload);
    const footer = (
        <div className="flex w-full flex-col gap-2">
            {error && <p role="alert" className="text-sm text-danger" data-testid="crest-picker-error">{error}</p>}
            <div className="flex justify-end gap-2">
                <CrestCancelButton onClose={props.onClose} />
                <Button onClick={() => save(api.draft)} loading={pending} disabled={!canSaveCrest(api.draft, props.state)} data-testid="crest-picker-save">Save crest</Button>
            </div>
        </div>
    );
    return <CrestPickerFrame onClose={props.onClose} footer={footer}><PickerBody {...props} api={api} upload={upload} /></CrestPickerFrame>;
}

/** Loads the editor state, then opens the picker on what the hub shows now (a loading / retry body until then). */
export function CrestPicker(props: CrestPickerProps): JSX.Element {
    const q = useGuildCrestEditor(props.guildId, true);
    if (q.data) return <LoadedPicker {...props} state={q.data} />;
    const footer = <div className="flex w-full justify-end"><CrestCancelButton onClose={props.onClose} /></div>;
    return (
        <CrestPickerFrame onClose={props.onClose} footer={footer}>
            {q.isError ? <CrestPickerLoadError onRetry={() => { void q.refetch(); }} /> : <CrestPickerLoading />}
        </CrestPickerFrame>
    );
}
