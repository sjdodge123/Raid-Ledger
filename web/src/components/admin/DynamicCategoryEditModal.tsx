/**
 * Edit modal for a pending discovery-category suggestion (ROK-567).
 *
 * v1 scope: name + description only. Validated with Zod on submit;
 * errors surface inline below each field through the shared `Field`
 * (aria-invalid + a role=alert message, ROK-1653).
 */
import { useId, useState, type JSX } from 'react';
import { z } from 'zod';
import type {
    AdminCategoryPatchDto,
    DiscoveryCategorySuggestionDto,
} from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';

const EditSchema = z.object({
    name: z.string().min(1, 'Name is required').max(120, 'Name is too long'),
    description: z.string().min(1, 'Description is required'),
});

interface DynamicCategoryEditModalProps {
    isOpen: boolean;
    suggestion: DiscoveryCategorySuggestionDto | null;
    onClose: () => void;
    onSave: (id: string, patch: AdminCategoryPatchDto) => Promise<void> | void;
    isSaving?: boolean;
}

function useEditForm(suggestion: DiscoveryCategorySuggestionDto) {
    const [name, setName] = useState(suggestion.name);
    const [description, setDescription] = useState(suggestion.description);
    const [errors, setErrors] = useState<{ name?: string; description?: string }>({});
    return { name, setName, description, setDescription, errors, setErrors };
}

interface EditFormBodyProps {
    suggestion: DiscoveryCategorySuggestionDto;
    onClose: () => void;
    onSave: (id: string, patch: AdminCategoryPatchDto) => Promise<void> | void;
    isSaving?: boolean;
}

function parseFieldErrors(zodErrors: z.ZodIssue[]) {
    const fieldErrors: { name?: string; description?: string } = {};
    for (const issue of zodErrors) {
        const key = issue.path[0] as 'name' | 'description';
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return fieldErrors;
}

/** Cancel / Save row of the edit modal (ROK-1530 D7; shared Buttons, ROK-1653). */
function EditFormActions({
    onClose,
    onSave,
    isSaving = false,
}: {
    onClose: () => void;
    onSave: () => void;
    isSaving?: boolean;
}): JSX.Element {
    return (
        <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose}>
                Cancel
            </Button>
            <Button onClick={onSave} loading={isSaving} loadingLabel="Saving…">
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

/** The two edit controls, grouped so `EditFormBody` stays short (ROK-1530 D7). */
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

function EditFormBody({
    suggestion,
    onClose,
    onSave,
    isSaving,
}: EditFormBodyProps): JSX.Element {
    const { name, setName, description, setDescription, errors, setErrors } =
        useEditForm(suggestion);
    const nameId = useId();
    const descId = useId();

    const handleSave = () =>
        validateThenSave({ name, description }, setErrors, (patch) =>
            onSave(suggestion.id, patch),
        );

    return (
        <div className="space-y-4">
            <EditFields
                ids={{ name: nameId, description: descId }}
                values={{ name, description }}
                onChange={{ name: setName, description: setDescription }}
                errors={errors}
            />
            <EditFormActions
                onClose={onClose}
                onSave={() => void handleSave()}
                isSaving={isSaving}
            />
        </div>
    );
}

export function DynamicCategoryEditModal({
    isOpen,
    suggestion,
    onClose,
    onSave,
    isSaving,
}: DynamicCategoryEditModalProps): JSX.Element | null {
    if (!suggestion) return null;
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Edit Category">
            <EditFormBody
                key={suggestion.id}
                suggestion={suggestion}
                onClose={onClose}
                onSave={onSave}
                isSaving={isSaving}
            />
        </Modal>
    );
}
