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

const INPUT_CLASS = 'w-full rounded-lg border border-edge bg-panel px-3 py-2 text-foreground placeholder:text-dim focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

function PugTextField({ id, label, value, onChange, placeholder, required, autoFocus, optional }: {
    id: string; label: string; value: string; onChange: (v: string) => void;
    placeholder: string; required?: boolean; autoFocus?: boolean; optional?: boolean;
}) {
    return (
        <div>
            <label htmlFor={id} className="block text-sm font-medium text-secondary mb-1">
                {label} {required ? <span className="text-red-400">*</span> : optional ? <span className="text-dim">(optional)</span> : null}
            </label>
            <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder} className={INPUT_CLASS} required={required} autoFocus={autoFocus} />
        </div>
    );
}

function PugRoleSelector({ role, onChange }: { role: PugRole; onChange: (r: PugRole) => void }) {
    return (
        <div>
            <label className="block text-sm font-medium text-secondary mb-1">Role <span className="text-red-400">*</span></label>
            <div className="flex gap-2">
                {ROLE_OPTIONS.map((opt) => (
                    <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
                        className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${role === opt.value ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300' : 'border-edge bg-panel text-muted hover:bg-panel/80'}`}>
                        <span className="mr-1">{opt.emoji}</span>{opt.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

function submitLabel(isSubmitting: boolean, isEditing: boolean) {
    if (isSubmitting) return isEditing ? 'Saving...' : 'Adding...';
    return isEditing ? 'Save Changes' : 'Add PUG';
}

function PugNotesField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div>
            <label htmlFor="pug-notes" className="block text-sm font-medium text-secondary mb-1">Notes <span className="text-dim">(optional)</span></label>
            <textarea id="pug-notes" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Any notes about this PUG..." rows={2} className={`${INPUT_CLASS} resize-none`} />
        </div>
    );
}

function PugFormActions({ onClose, isSubmitting, isEditing, canSubmit }: { onClose: () => void; isSubmitting: boolean; isEditing: boolean; canSubmit: boolean }) {
    return (
        <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn btn-secondary btn-sm" disabled={isSubmitting}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!canSubmit || isSubmitting}>{submitLabel(isSubmitting, isEditing)}</button>
        </div>
    );
}

function PugFormBody({
    editingPug, onSubmit, onClose, isSubmitting, isEditing, isMMOGame,
}: {
    editingPug?: PugSlotResponseDto | null; onSubmit: PugFormModalProps['onSubmit'];
    onClose: () => void; isSubmitting: boolean; isEditing: boolean; isMMOGame: boolean;
}) {
    const [discordUsername, setDiscordUsername] = useState(editingPug?.discordUsername ?? '');
    const [role, setRole] = useState<PugRole>(editingPug?.role ?? (isMMOGame ? 'dps' : 'player'));
    const [charClass, setCharClass] = useState(editingPug?.class ?? '');
    const [spec, setSpec] = useState(editingPug?.spec ?? '');
    const [notes, setNotes] = useState(editingPug?.notes ?? '');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!discordUsername.trim()) return;
        onSubmit({ discordUsername: discordUsername.trim(), role, class: charClass.trim() || undefined, spec: spec.trim() || undefined, notes: notes.trim() || undefined });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <PugTextField id="pug-discord-username" label="Discord Username" value={discordUsername} onChange={setDiscordUsername} placeholder="e.g. CoolPlayer#1234" required autoFocus />
            {isMMOGame && <PugRoleSelector role={role} onChange={setRole} />}
            {isMMOGame && <PugTextField id="pug-class" label="Class" value={charClass} onChange={setCharClass} placeholder="e.g. Warrior, Paladin" optional />}
            {isMMOGame && <PugTextField id="pug-spec" label="Spec" value={spec} onChange={setSpec} placeholder="e.g. Protection, Holy" optional />}
            <PugNotesField value={notes} onChange={setNotes} />
            <PugFormActions onClose={onClose} isSubmitting={isSubmitting} isEditing={isEditing} canSubmit={!!discordUsername.trim()} />
        </form>
    );
}
