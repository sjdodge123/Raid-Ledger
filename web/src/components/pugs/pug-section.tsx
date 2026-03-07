/**
 * PugSection - Displays PUG (Pick Up Group) slots alongside the roster (ROK-262).
 * Shows Add PUG button for creators/officers, and lists all PUG cards grouped by role.
 * PUGs count toward role composition totals.
 */
import { useState } from 'react';
import type { PugSlotResponseDto, PugRole } from '@raid-ledger/contract';
import { toast } from '../../lib/toast';
import { usePugs, useCreatePug, useUpdatePug, useDeletePug, useRegeneratePugInviteCode } from '../../hooks/use-pugs';
import { PugCard } from './pug-card';
import { PugFormModal } from './pug-form-modal';
import { formatRole } from '../../lib/role-colors';

interface PugSectionProps {
    eventId: number;
    /** Whether the current user can add/edit/remove PUGs */
    canManage: boolean;
    /** Whether the event's game is an MMO (shows class/spec fields in PUG form) */
    isMMOGame?: boolean;
}

function errorDesc(err: unknown) {
    return err instanceof Error ? err.message : 'Please try again.';
}

function usePugActions(eventId: number) {
    const createPug = useCreatePug(eventId);
    const updatePug = useUpdatePug(eventId);
    const deletePug = useDeletePug(eventId);
    const regenerateCode = useRegeneratePugInviteCode(eventId);

    const handleRemove = async (pugId: string) => {
        try { await deletePug.mutateAsync(pugId); toast.success('PUG removed from roster'); }
        catch (err) { toast.error('Failed to remove PUG', { description: errorDesc(err) }); }
    };

    const handleRegenerateLink = async (pugId: string) => {
        try {
            const updated = await regenerateCode.mutateAsync(pugId);
            if (updated.inviteCode) {
                await navigator.clipboard.writeText(`${window.location.origin}/i/${updated.inviteCode}`);
                toast.success('New invite link copied to clipboard!');
            }
        } catch (err) { toast.error('Failed to regenerate link', { description: errorDesc(err) }); }
    };

    return { createPug, updatePug, handleRemove, handleRegenerateLink };
}

function PugCardGrid({ pugs, isLoading, canManage, isMMOGame, onEdit, onRemove, onRegenerateLink }: {
    pugs: PugSlotResponseDto[]; isLoading: boolean; canManage: boolean; isMMOGame: boolean;
    onEdit: (pug: PugSlotResponseDto) => void; onRemove: (id: string) => Promise<void>;
    onRegenerateLink: (id: string) => Promise<void>;
}) {
    if (isLoading) return <div className="flex items-center justify-center py-4"><span className="text-sm text-muted">Loading PUGs...</span></div>;
    if (pugs.length === 0) return <div className="flex items-center justify-center py-4 text-sm text-dim">No PUGs added yet{canManage && ' \u2014 use the Assign modal to add PUGs'}</div>;
    return (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 sm:gap-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
            {pugs.map((pug) => <PugCard key={pug.id} pug={pug} canManage={canManage} onEdit={onEdit} onRemove={onRemove} onRegenerateLink={canManage ? onRegenerateLink : undefined} showRole={isMMOGame} />)}
        </div>
    );
}

function PugSectionHeader({ count }: { count: number }) {
    return (
        <div className="flex items-center justify-between mb-3">
            <h4 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-secondary">
                <span className="inline-block h-3 w-3 rounded bg-amber-500" />PUGs (Guest Players)
                {count > 0 && <span className="text-xs font-normal normal-case text-muted">({count})</span>}
            </h4>
        </div>
    );
}

function PugRoleCounts({ pugCountByRole, isMMOGame, hasPugs }: { pugCountByRole: Record<string, number>; isMMOGame: boolean; hasPugs: boolean }) {
    if (!isMMOGame || !hasPugs || Object.keys(pugCountByRole).length === 0) return null;
    return <div className="flex gap-3 mb-3 text-xs text-muted">{Object.entries(pugCountByRole).map(([role, count]) => <span key={role}>{formatRole(role)}: {count}</span>)}</div>;
}

export function PugSection({ eventId, canManage, isMMOGame = false }: PugSectionProps) {
    const { data: pugData, isLoading } = usePugs(eventId);
    const { createPug, updatePug, handleRemove, handleRegenerateLink } = usePugActions(eventId);
    const [showFormModal, setShowFormModal] = useState(false);
    const [editingPug, setEditingPug] = useState<PugSlotResponseDto | null>(null);
    const pugs = pugData?.pugs ?? [];
    const pugCountByRole = pugs.reduce<Record<string, number>>((acc, pug) => { acc[pug.role] = (acc[pug.role] ?? 0) + 1; return acc; }, {});
    const handleEdit = (pug: PugSlotResponseDto) => { setEditingPug(pug); setShowFormModal(true); };
    const closeForm = () => { setShowFormModal(false); setEditingPug(null); };

    if (pugs.length === 0 && !canManage) return null;

    return (
        <div className="rounded-lg border border-edge bg-surface/50 p-4">
            <PugSectionHeader count={pugs.length} />
            <PugRoleCounts pugCountByRole={pugCountByRole} isMMOGame={isMMOGame} hasPugs={pugs.length > 0} />
            <PugCardGrid pugs={pugs} isLoading={isLoading} canManage={canManage} isMMOGame={isMMOGame} onEdit={handleEdit} onRemove={handleRemove} onRegenerateLink={handleRegenerateLink} />
            <PugFormModal isOpen={showFormModal} onClose={closeForm} editingPug={editingPug} onSubmit={makePugSubmitHandler(editingPug, createPug, updatePug, closeForm)} isSubmitting={createPug.isPending || updatePug.isPending} isMMOGame={isMMOGame} />
        </div>
    );
}

function makePugSubmitHandler(
    editingPug: PugSlotResponseDto | null,
    createPug: ReturnType<typeof useCreatePug>,
    updatePug: ReturnType<typeof useUpdatePug>,
    closeForm: () => void,
) {
    return async (data: { discordUsername: string; role: PugRole; class?: string; spec?: string; notes?: string }) => {
        try {
            if (editingPug) { await updatePug.mutateAsync({ pugId: editingPug.id, dto: data }); toast.success(`PUG "${data.discordUsername}" updated`); }
            else { await createPug.mutateAsync(data); toast.success(`PUG "${data.discordUsername}" added to roster`); }
            closeForm();
        } catch (err) { toast.error(editingPug ? 'Failed to update PUG' : 'Failed to add PUG', { description: errorDesc(err) }); }
    };
}
