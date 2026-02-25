/**
 * PugFormModal - Modal form for adding or editing a PUG slot (ROK-262).
 * Fields: Discord username (required), role (required), class (optional), notes (optional).
 */
import { useState } from 'react';
import { Modal } from '../ui/modal';
import type { PugSlotResponseDto, PugRole } from '@raid-ledger/contract';

interface PugFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** If provided, the modal is in edit mode */
    editingPug?: PugSlotResponseDto | null;
    /** Called on submit with form data */
    onSubmit: (data: {
        discordUsername: string;
        role: PugRole;
        class?: string;
        spec?: string;
        notes?: string;
    }) => void;
    /** Whether the form is submitting */
    isSubmitting?: boolean;
    /** Whether the event's game is an MMO (shows role/class/spec fields) */
    isMMOGame?: boolean;
}

const ROLE_OPTIONS: { value: PugRole; label: string; emoji: string }[] = [
    { value: 'tank', label: 'Tank', emoji: '\u{1F6E1}\uFE0F' },
    { value: 'healer', label: 'Healer', emoji: '\u{1F49A}' },
    { value: 'dps', label: 'DPS', emoji: '\u2694\uFE0F' },
];

export function PugFormModal({
    isOpen,
    onClose,
    editingPug,
    onSubmit,
    isSubmitting = false,
    isMMOGame = false,
}: PugFormModalProps) {
    const isEditing = !!editingPug;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={isEditing ? 'Edit PUG' : 'Add PUG'}
        >
            {/* Key forces re-mount when switching between add/edit, resetting form state */}
            <PugFormBody
                key={editingPug?.id ?? 'new'}
                editingPug={editingPug}
                onSubmit={onSubmit}
                onClose={onClose}
                isSubmitting={isSubmitting}
                isEditing={isEditing}
                isMMOGame={isMMOGame}
            />
        </Modal>
    );
}

/** Inner form body — keyed to re-mount when editingPug changes */
function PugFormBody({
    editingPug,
    onSubmit,
    onClose,
    isSubmitting,
    isEditing,
    isMMOGame,
}: {
    editingPug?: PugSlotResponseDto | null;
    onSubmit: PugFormModalProps['onSubmit'];
    onClose: () => void;
    isSubmitting: boolean;
    isEditing: boolean;
    isMMOGame: boolean;
}) {
    const [discordUsername, setDiscordUsername] = useState(
        editingPug?.discordUsername ?? '',
    );
    const [role, setRole] = useState<PugRole>(editingPug?.role ?? (isMMOGame ? 'dps' : 'player'));
    const [charClass, setCharClass] = useState(editingPug?.class ?? '');
    const [spec, setSpec] = useState(editingPug?.spec ?? '');
    const [notes, setNotes] = useState(editingPug?.notes ?? '');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!discordUsername.trim()) return;
        onSubmit({
            discordUsername: discordUsername.trim(),
            role,
            class: charClass.trim() || undefined,
            spec: spec.trim() || undefined,
            notes: notes.trim() || undefined,
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            {/* Discord Username */}
            <div>
                <label
                    htmlFor="pug-discord-username"
                    className="block text-sm font-medium text-secondary mb-1"
                >
                    Discord Username <span className="text-red-400">*</span>
                </label>
                <input
                    id="pug-discord-username"
                    type="text"
                    value={discordUsername}
                    onChange={(e) => setDiscordUsername(e.target.value)}
                    placeholder="e.g. CoolPlayer#1234"
                    className="w-full rounded-lg border border-edge bg-panel px-3 py-2 text-foreground placeholder:text-dim focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    required
                    autoFocus
                />
            </div>

            {/* Role Selector (MMO games only) */}
            {isMMOGame && (
                <div>
                    <label className="block text-sm font-medium text-secondary mb-1">
                        Role <span className="text-red-400">*</span>
                    </label>
                    <div className="flex gap-2">
                        {ROLE_OPTIONS.map((opt) => (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setRole(opt.value)}
                                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                                    role === opt.value
                                        ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                                        : 'border-edge bg-panel text-muted hover:bg-panel/80'
                                }`}
                            >
                                <span className="mr-1">{opt.emoji}</span>
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Class & Spec (optional, MMO games only) */}
            {isMMOGame && (
                <>
                    <div>
                        <label
                            htmlFor="pug-class"
                            className="block text-sm font-medium text-secondary mb-1"
                        >
                            Class <span className="text-dim">(optional)</span>
                        </label>
                        <input
                            id="pug-class"
                            type="text"
                            value={charClass}
                            onChange={(e) => setCharClass(e.target.value)}
                            placeholder="e.g. Warrior, Paladin"
                            className="w-full rounded-lg border border-edge bg-panel px-3 py-2 text-foreground placeholder:text-dim focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                    </div>

                    <div>
                        <label
                            htmlFor="pug-spec"
                            className="block text-sm font-medium text-secondary mb-1"
                        >
                            Spec <span className="text-dim">(optional)</span>
                        </label>
                        <input
                            id="pug-spec"
                            type="text"
                            value={spec}
                            onChange={(e) => setSpec(e.target.value)}
                            placeholder="e.g. Protection, Holy"
                            className="w-full rounded-lg border border-edge bg-panel px-3 py-2 text-foreground placeholder:text-dim focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                    </div>
                </>
            )}

            {/* Notes (optional) */}
            <div>
                <label
                    htmlFor="pug-notes"
                    className="block text-sm font-medium text-secondary mb-1"
                >
                    Notes <span className="text-dim">(optional)</span>
                </label>
                <textarea
                    id="pug-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any notes about this PUG..."
                    rows={2}
                    className="w-full rounded-lg border border-edge bg-panel px-3 py-2 text-foreground placeholder:text-dim focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
                <button
                    type="button"
                    onClick={onClose}
                    className="btn btn-secondary btn-sm"
                    disabled={isSubmitting}
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={!discordUsername.trim() || isSubmitting}
                >
                    {isSubmitting
                        ? isEditing
                            ? 'Saving...'
                            : 'Adding...'
                        : isEditing
                            ? 'Save Changes'
                            : 'Add PUG'}
                </button>
            </div>
        </form>
    );
}
