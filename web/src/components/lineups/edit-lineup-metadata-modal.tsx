/**
 * Edit lineup title + description (ROK-1063).
 * Opens from LineupDetailHeader "Edit" button. Same validation as creation.
 */
import { useState, type JSX } from 'react';
import { Modal } from '../ui/modal';
import { useUpdateLineupMetadata } from '../../hooks/use-lineups';
import { toast } from '../../lib/toast';

interface Props {
    lineupId: number;
    initialTitle: string;
    initialDescription: string | null;
    onClose: () => void;
}

const DESCRIPTION_MAX = 500;

function TitleField({ value, onChange }: {
    value: string;
    onChange: (v: string) => void;
}): JSX.Element {
    return (
        <div>
            <label htmlFor="edit-lineup-title" className="block text-sm font-medium text-secondary mb-1">
                Title <span className="text-rose-400">*</span>
            </label>
            <input
                id="edit-lineup-title"
                type="text"
                required
                maxLength={100}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
        </div>
    );
}

function DescriptionField({ value, onChange }: {
    value: string;
    onChange: (v: string) => void;
}): JSX.Element {
    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <label htmlFor="edit-lineup-description" className="block text-sm font-medium text-secondary">
                    Description
                </label>
                <span className="text-xs text-muted tabular-nums">
                    {value.length} / {DESCRIPTION_MAX}
                </span>
            </div>
            <textarea
                id="edit-lineup-description"
                rows={4}
                maxLength={DESCRIPTION_MAX}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
        </div>
    );
}

export function EditLineupMetadataModal({ lineupId, initialTitle, initialDescription, onClose }: Props): JSX.Element {
    const [title, setTitle] = useState(initialTitle);
    const [description, setDescription] = useState(initialDescription ?? '');
    const update = useUpdateLineupMetadata();

    async function handleSave() {
        const trimmed = title.trim();
        if (!trimmed) {
            toast.error('Title is required');
            return;
        }
        try {
            await update.mutateAsync({
                lineupId,
                body: {
                    title: trimmed,
                    description: description.trim() === '' ? null : description,
                },
            });
            toast.success('Lineup updated');
            onClose();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update lineup');
        }
    }

    return (
        <Modal isOpen={true} onClose={onClose} title="Edit Lineup">
            <div className="space-y-4">
                <TitleField value={title} onChange={setTitle} />
                <DescriptionField value={description} onChange={setDescription} />
                <div className="flex justify-end gap-3 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-secondary bg-panel border border-edge rounded-lg hover:bg-overlay transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleSave()}
                        disabled={update.isPending || title.trim() === ''}
                        className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50"
                    >
                        {update.isPending ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
