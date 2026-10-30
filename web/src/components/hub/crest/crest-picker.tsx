/**
 * ROK-1814 L6 — the crest editor: a `Modal` at ≥1024 px, a `BottomSheet`
 * below (DS §4.4). A segmented `RadioGroup` picks Upload / Emblem / Gallery /
 * None (Gallery = operator ruling Q1); Save writes the draft. An upload saves
 * on pick (the server makes it active), so Save there just keeps it shown.
 */
import type { JSX } from 'react';
import type { GuildCrestEditorState } from '@raid-ledger/contract';
import { BottomSheet } from '../../ui/bottom-sheet';
import { Button } from '../../ui/button';
import { Modal } from '../../ui/modal';
import { RadioGroup } from '../../ui/radio-group';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { useGuildCrestEditor, usePickGuildCrestFromGallery, useSetGuildCrest, useUploadGuildCrest } from './use-guild-crest';
import { canSaveCrest, setBodyFor, useCrestDraft, type CrestMode } from './crest-picker-draft';
import { crestErrorMessage, removedNotice } from './crest-picker-copy';
import { CrestPresetSection } from './crest-picker-preset';
import { CrestGallerySection, CrestUploadSection } from './crest-picker-sources';

const MODES: readonly { value: CrestMode; label: string }[] = [
    { value: 'upload', label: 'Upload' }, { value: 'preset', label: 'Emblem' },
    { value: 'gallery', label: 'Gallery' }, { value: 'none', label: 'None' },
];

export interface CrestPickerProps { guildId: number; name: string; onClose: () => void }

interface LoadedProps extends CrestPickerProps { state: GuildCrestEditorState }

function useCrestSave({ guildId, onClose }: CrestPickerProps): { save: (draft: ReturnType<typeof useCrestDraft>['draft']) => void; pending: boolean; error: string | null } {
    const set = useSetGuildCrest(guildId);
    const pick = usePickGuildCrestFromGallery(guildId);
    const failed = set.error ?? pick.error;
    return {
        save: (draft) => {
            const body = setBodyFor(draft);
            if (body) set.mutate(body, { onSuccess: onClose });
            else if (draft.mediaId !== null) pick.mutate(draft.mediaId, { onSuccess: onClose });
        },
        pending: set.isPending || pick.isPending,
        error: failed ? crestErrorMessage(failed) : null,
    };
}

function PickerBody({ state, guildId, name, api, upload }: LoadedProps & { api: ReturnType<typeof useCrestDraft>; upload: ReturnType<typeof useUploadGuildCrest> }): JSX.Element {
    const { draft } = api;
    return (
        <div className="flex flex-col gap-4" data-testid="crest-picker">
            {state.removedByStaffAt && <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground" data-testid="crest-removed-notice">{removedNotice(state.removedByStaffAt)}</p>}
            <RadioGroup label="Crest type" hideLabel appearance="segmented" options={MODES} value={draft.mode} onChange={api.setMode} />
            {draft.mode === 'upload' && <CrestUploadSection state={state} name={name} uploading={upload.isPending} error={upload.error ? crestErrorMessage(upload.error) : null} onFile={(f) => upload.mutate(f)} />}
            {draft.mode === 'preset' && <CrestPresetSection preset={draft.preset} name={name} onChange={api.setPreset} />}
            {draft.mode === 'gallery' && <CrestGallerySection guildId={guildId} mediaId={draft.mediaId} onPick={api.setMediaId} />}
            {draft.mode === 'none' && <p className="text-sm text-muted">The hub shows its initials. Your stored crest is kept, so you can switch back.</p>}
        </div>
    );
}

function LoadedPicker(props: LoadedProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const api = useCrestDraft(props.state);
    const upload = useUploadGuildCrest(props.guildId);
    const { save, pending, error } = useCrestSave(props);
    const footer = (
        <div className="flex w-full flex-col gap-2">
            {error && <p role="alert" className="text-sm text-danger" data-testid="crest-picker-error">{error}</p>}
            <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={props.onClose} data-testid="crest-picker-cancel">Cancel</Button>
                <Button onClick={() => save(api.draft)} disabled={pending || !canSaveCrest(api.draft, props.state)} data-testid="crest-picker-save">Save crest</Button>
            </div>
        </div>
    );
    const shared = { isOpen: true, onClose: props.onClose, title: 'Crest', footer };
    const body = <PickerBody {...props} api={api} upload={upload} />;
    if (isDesktop) return <Modal {...shared} maxWidth="max-w-lg">{body}</Modal>;
    return <BottomSheet {...shared} maxHeight="85vh">{body}</BottomSheet>;
}

/** Loads the editor state, then opens the picker on what the hub shows now. */
export function CrestPicker(props: CrestPickerProps): JSX.Element | null {
    const q = useGuildCrestEditor(props.guildId, true);
    if (!q.data) return null;
    return <LoadedPicker {...props} state={q.data} />;
}
