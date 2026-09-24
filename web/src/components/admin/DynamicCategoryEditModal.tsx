/**
 * Edit modal for a pending discovery-category suggestion (ROK-567).
 *
 * v1 scope: name + description only. Validated with Zod on submit;
 * errors surface inline below each field through the shared `Field`
 * (aria-invalid + a role=alert message, ROK-1653).
 *
 * ROK-1655 (ROK-1653 G5c): an edit is guarded — Escape, the backdrop, × and
 * Cancel ask "Discard your changes?" — and Cancel / Save sit in the Modal's
 * pinned footer, Save submitting the form through `form=`. A successful save
 * closes via the parent nulling `suggestion`, which bypasses the guard.
 */
import { useId, useState, type FormEvent, type JSX } from 'react';
import { z } from 'zod';
import type {
    AdminCategoryPatchDto,
    DiscoveryCategorySuggestionDto,
} from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { useDirtyCloseGuard } from '../../hooks/use-dirty-close-guard';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';

const EditSchema = z.object({
    name: z.string().min(1, 'Name is required').max(120, 'Name is too long'),
    description: z.string().min(1, 'Description is required'),
});

const FORM_ID = 'dynamic-category-edit-form';

interface DynamicCategoryEditModalProps {
    isOpen: boolean;
    suggestion: DiscoveryCategorySuggestionDto | null;
    onClose: () => void;
    onSave: (id: string, patch: AdminCategoryPatchDto) => Promise<void> | void;
    isSaving?: boolean;
}

type EditCategoryModalProps = Omit<DynamicCategoryEditModalProps, 'suggestion'> & {
    suggestion: DiscoveryCategorySuggestionDto;
};

function parseFieldErrors(zodErrors: z.ZodIssue[]) {
    const fieldErrors: { name?: string; description?: string } = {};
    for (const issue of zodErrors) {
        const key = issue.path[0] as 'name' | 'description';
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return fieldErrors;
}

/**
 * Cancel / Save for the pinned footer (ROK-1530 D7; shared Buttons, ROK-1653).
 * Cancel goes through the guard; Save submits the form it sits outside of.
 */
function EditFormActions({
    onCancel,
    isSaving = false,
}: {
    onCancel: () => void;
    isSaving?: boolean;
}): JSX.Element {
    return (
        <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onCancel}>
                Cancel
            </Button>
            <Button type="submit" form={FORM_ID} loading={isSaving} loadingLabel="Saving…">
                Save
            </Button>
        </div>
    );
}

/**
 * Validate the draft and hand the parsed patch to `save`; on failure push the
 * per-field messages into form state and save nothing (ROK-1530 D7).
 */
async function validateThenSave(
    draft: { name: string; description: string },
    setErrors: (e: Record<string, string>) => void,
    save: (patch: { name: string; description: string }) => Promise<void> | void,
): Promise<void> {
    const parsed = EditSchema.safeParse(draft);
    if (!parsed.success) {
        setErrors(parseFieldErrors(parsed.error.issues));
        return;
    }
    await save(parsed.data);
}

/** The two edit controls, grouped so the modal stays short (ROK-1530 D7). */
interface EditFieldsProps {
    ids: { name: string; description: string };
    values: { name: string; description: string };
    onChange: { name: (v: string) => void; description: (v: string) => void };
    errors: { name?: string; description?: string };
}

function EditFields({
    ids,
    values,
    onChange,
    errors,
}: EditFieldsProps): JSX.Element {
    return (
        <>
            {/* Name is not marked `required`: the asterisk would break the smoke's getByLabel(/^Name$/i). */}
            <Field id={ids.name} label="Name" error={errors.name}>
                <Input
                    type="text"
                    value={values.name}
                    onChange={(e) => onChange.name(e.target.value)}
                />
            </Field>
            <Field id={ids.description} label="Description" error={errors.description}>
                <Textarea
                    rows={4}
                    value={values.description}
                    onChange={(e) => onChange.description(e.target.value)}
                />
            </Field>
        </>
    );
}

/** Draft state, field ids, dirtiness and the submit handler (ROK-1655). */
function useDynamicCategoryEditForm(
    suggestion: DiscoveryCategorySuggestionDto,
    onSave: DynamicCategoryEditModalProps['onSave'],
) {
    const [name, setName] = useState(suggestion.name);
    const [description, setDescription] = useState(suggestion.description);
    const [errors, setErrors] = useState<{ name?: string; description?: string }>({});
    const ids = { name: useId(), description: useId() };
    const isDirty = name !== suggestion.name || description !== suggestion.description;
    const submit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        void validateThenSave({ name, description }, setErrors, (patch) =>
            onSave(suggestion.id, patch),
        );
    };
    return { ids, values: { name, description }, onChange: { name: setName, description: setDescription },
        errors, isDirty, submit };
}

/** Keyed per suggestion, so the draft and the guard start fresh for each one. */
function EditCategoryModal({
    isOpen,
    suggestion,
    onClose,
    onSave,
    isSaving,
}: EditCategoryModalProps): JSX.Element {
    const form = useDynamicCategoryEditForm(suggestion, onSave);
    const guard = useDirtyCloseGuard(form.isDirty, onClose);
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Edit Category"
            closeGuard={guard}
            footer={<EditFormActions onCancel={guard.requestClose} isSaving={isSaving} />}
        >
            <form id={FORM_ID} noValidate onSubmit={form.submit} className="space-y-4">
                <EditFields ids={form.ids} values={form.values} onChange={form.onChange} errors={form.errors} />
            </form>
        </Modal>
    );
}

export function DynamicCategoryEditModal({
    suggestion,
    ...props
}: DynamicCategoryEditModalProps): JSX.Element | null {
    if (!suggestion) return null;
    return <EditCategoryModal key={suggestion.id} suggestion={suggestion} {...props} />;
}
