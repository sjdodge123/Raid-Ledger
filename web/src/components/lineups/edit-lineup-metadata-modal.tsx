/**
 * Edit lineup title + description (ROK-1063).
 * Opens from LineupDetailHeader "Edit" button. Same validation as creation.
 *
 * ROK-1655: Escape, the backdrop, × and the explicit Cancel all go through
 * `useDirtyCloseGuard`, so edited text is never dropped without "Discard your
 * changes?". Cancel + Save sit in the Modal's pinned `footer`; Save reaches the
 * fields' `<form>` through `form=`, so Enter in the title submits too.
 */
import { useState, type FormEvent, type JSX } from 'react';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { useUpdateLineupMetadata } from '../../hooks/use-lineups';
import { useDirtyCloseGuard } from '../../hooks/use-dirty-close-guard';
import { toast } from '../../lib/toast';

interface Props {
    lineupId: number;
    initialTitle: string;
    initialDescription: string | null;
    onClose: () => void;
}

const DESCRIPTION_MAX = 500;
const TITLE_REQUIRED = 'Title is required';
const FORM_ID = 'edit-lineup-metadata-form';

/** Required title. The blank-title error is inline (ROK-1650 AC2), shown once the field is left. */
function TitleField({ value, onChange, error, onBlur }: {
    value: string;
    onChange: (v: string) => void;
    error?: string;
    onBlur: () => void;
}): JSX.Element {
    return (
        <Field label="Title" id="edit-lineup-title" required error={error}>
            <Input
                type="text"
                required
                maxLength={100}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onBlur={onBlur}
            />
        </Field>
    );
}

function DescriptionField({ value, onChange }: {
    value: string;
    onChange: (v: string) => void;
}): JSX.Element {
    return (
        <Field label="Description" id="edit-lineup-description">
            <Textarea
                rows={4}
                showCount
                maxLength={DESCRIPTION_MAX}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="Optional markdown — **bold**, *italic*, `code`, [link](https://example.com)"
            />
        </Field>
    );
}

/**
 * Footer Cancel + Save. Cancel is guarded (ruling 4); Save submits the form via
 * `form=`, is disabled while the title is blank and busy while saving (ruling 7).
 */
function EditActions({ onCancel, saveDisabled, isPending }: {
    onCancel: () => void;
    saveDisabled: boolean;
    isPending: boolean;
}): JSX.Element {
    return (
        <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button type="submit" form={FORM_ID} variant="primary" disabled={saveDisabled} loading={isPending} loadingLabel="Saving…">
                Save
            </Button>
        </div>
    );
}

/** Form state + save. A blank title surfaces inline; only server errors toast. */
function useEditLineupForm({ lineupId, initialTitle, initialDescription, onClose }: Props) {
    const [title, setTitle] = useState(initialTitle);
    const [description, setDescription] = useState(initialDescription ?? '');
    const [titleTouched, setTitleTouched] = useState(false);
    const update = useUpdateLineupMetadata();
    const titleBlank = title.trim() === '';

    async function save() {
        if (titleBlank) {
            setTitleTouched(true);
            return;
        }
        try {
            const body = { title: title.trim(), description: description.trim() === '' ? null : description };
            await update.mutateAsync({ lineupId, body });
            toast.success('Lineup updated');
            onClose();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update lineup');
        }
    }

    const titleError = titleTouched && titleBlank ? TITLE_REQUIRED : undefined;
    const isDirty = title !== initialTitle || description !== (initialDescription ?? '');
    return { title, setTitle, description, setDescription, titleBlank, titleError, isDirty,
        touchTitle: () => setTitleTouched(true), isPending: update.isPending, save };
}

export function EditLineupMetadataModal(props: Props): JSX.Element {
    const form = useEditLineupForm(props);
    const guard = useDirtyCloseGuard(form.isDirty, props.onClose);
    const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); void form.save(); };
    return (
        <Modal
            isOpen={true}
            onClose={props.onClose}
            title="Edit Lineup"
            closeGuard={guard}
            footer={<EditActions onCancel={guard.requestClose} saveDisabled={form.titleBlank} isPending={form.isPending} />}
        >
            <form id={FORM_ID} noValidate onSubmit={submit} className="space-y-4">
                <TitleField value={form.title} onChange={form.setTitle} error={form.titleError} onBlur={form.touchTitle} />
                <DescriptionField value={form.description} onChange={form.setDescription} />
            </form>
        </Modal>
    );
}
