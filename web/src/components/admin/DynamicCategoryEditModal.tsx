/**
 * Edit modal for a pending discovery-category suggestion (ROK-567).
 *
 * v1 scope: name + description only. Validated with Zod on submit;
 * errors surface inline below each field.
 */
import { useEffect, useId, useState, type JSX } from 'react';
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

function useEditForm(suggestion: DiscoveryCategorySuggestionDto | null) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [errors, setErrors] = useState<{ name?: string; description?: string }>({});
    useEffect(() => {
        if (suggestion) {
            setName(suggestion.name);
            setDescription(suggestion.description);
            setErrors({});
        }
    }, [suggestion]);
    return { name, setName, description, setDescription, errors, setErrors };
}

function FieldError({ message }: { message?: string }) {
    if (!message) return null;
    return <p className="text-xs text-red-400 mt-1">{message}</p>;
}

export function DynamicCategoryEditModal({
    isOpen,
    suggestion,
    onClose,
    onSave,
    isSaving,
}: DynamicCategoryEditModalProps): JSX.Element | null {
    const { name, setName, description, setDescription, errors, setErrors } =
        useEditForm(suggestion);
    const nameId = useId();
    const descId = useId();

    if (!suggestion) return null;

    const handleSave = async () => {
        const parsed = EditSchema.safeParse({ name, description });
        if (!parsed.success) {
            const fieldErrors: { name?: string; description?: string } = {};
            for (const issue of parsed.error.errors) {
                const key = issue.path[0] as 'name' | 'description';
                if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
            }
            setErrors(fieldErrors);
            return;
        }
        await onSave(suggestion.id, parsed.data);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Edit Category">
            <div className="space-y-4">
                <div>
                    <label
                        htmlFor={nameId}
                        className="block text-xs uppercase tracking-wider text-muted mb-1"
                    >
                        Name
                    </label>
                    <input
                        id={nameId}
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full px-3 py-2 bg-surface/50 border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <FieldError message={errors.name} />
                </div>
                <div>
                    <label
                        htmlFor={descId}
                        className="block text-xs uppercase tracking-wider text-muted mb-1"
                    >
                        Description
                    </label>
                    <textarea
                        id={descId}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={4}
                        className="w-full px-3 py-2 bg-surface/50 border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <FieldError message={errors.description} />
                </div>
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
                        onClick={() => void handleSave()}
                        disabled={isSaving}
                        className="px-3 py-1.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-foreground rounded-lg transition-colors"
                    >
                        {isSaving ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
