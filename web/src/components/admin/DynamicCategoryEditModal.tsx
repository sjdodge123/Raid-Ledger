/**
 * Edit modal for a pending discovery-category suggestion (ROK-567).
 *
 * v1 scope: name + description only. Validated with Zod on submit;
 * errors surface inline below each field.
 */
import { useId, useState, type JSX } from 'react';
import { z } from 'zod';
import type {
    AdminCategoryPatchDto,
    DiscoveryCategorySuggestionDto,
} from '@raid-ledger/contract';
import { Modal } from '../ui/modal';

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

function FieldError({ message }: { message?: string }) {
    if (!message) return null;
    return <p className="text-xs text-red-400 mt-1">{message}</p>;
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

const FIELD_CLASSES =
    'w-full px-3 py-2 bg-surface/50 border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500';

/**
 * Label + control + inline error, shared by the name input and the
 * description textarea (ROK-1530 D7). `multiline` picks the control.
 */
interface LabelledInputProps {
    id: string;
    label: string;
    value: string;
    onChange: (next: string) => void;
    error?: string;
    multiline?: boolean;
}

/** Uppercase field caption shared by both edit-modal controls (ROK-1530 D7). */
function FieldLabel({
    htmlFor,
    label,
}: {
    htmlFor: string;
    label: string;
}): JSX.Element {
    return (
        <label
            htmlFor={htmlFor}
            className="block text-xs uppercase tracking-wider text-muted mb-1"
        >
            {label}
        </label>
    );
}

function LabelledInput({
    id,
    label,
    value,
    onChange,
    error,
    multiline,
}: LabelledInputProps): JSX.Element {
    const shared = {
        id,
        value,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
        className: FIELD_CLASSES,
    };
    return (
        <div>
            <FieldLabel htmlFor={id} label={label} />
            {multiline ? (
                <textarea {...shared} rows={4} />
            ) : (
                <input {...shared} type="text" />
            )}
            <FieldError message={error} />
        </div>
    );
}

/** Cancel / Save footer of the edit modal (ROK-1530 D7). */
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
            <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-sm bg-overlay hover:bg-faint text-foreground border border-edge rounded-lg transition-colors"
            >
                Cancel
            </button>
            <button
                type="button"
                onClick={onSave}
                disabled={isSaving}
                className="px-3 py-1.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-foreground rounded-lg transition-colors"
            >
                {isSaving ? 'Saving…' : 'Save'}
            </button>
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
            <LabelledInput
                id={ids.name}
                label="Name"
                value={values.name}
                onChange={onChange.name}
                error={errors.name}
            />
            <LabelledInput
                id={ids.description}
                label="Description"
                value={values.description}
                onChange={onChange.description}
                error={errors.description}
                multiline
            />
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
