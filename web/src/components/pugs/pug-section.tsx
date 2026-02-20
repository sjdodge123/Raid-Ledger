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

export function PugSection({ eventId, canManage, isMMOGame = false }: PugSectionProps) {
    const { data: pugData, isLoading } = usePugs(eventId);
    const createPug = useCreatePug(eventId);
    const updatePug = useUpdatePug(eventId);
    const deletePug = useDeletePug(eventId);
    const regenerateCode = useRegeneratePugInviteCode(eventId);

    const [showFormModal, setShowFormModal] = useState(false);
    const [editingPug, setEditingPug] = useState<PugSlotResponseDto | null>(null);

    const pugs = pugData?.pugs ?? [];

    // Count PUGs by role for composition display
    const pugCountByRole = pugs.reduce<Record<string, number>>((acc, pug) => {
        acc[pug.role] = (acc[pug.role] ?? 0) + 1;
        return acc;
    }, {});

    const handleEdit = (pug: PugSlotResponseDto) => {
        setEditingPug(pug);
        setShowFormModal(true);
    };

    const handleRemove = async (pugId: string) => {
        try {
            await deletePug.mutateAsync(pugId);
            toast.success('PUG removed from roster');
        } catch (err) {
            toast.error('Failed to remove PUG', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    const handleRegenerateLink = async (pugId: string) => {
        try {
            const updated = await regenerateCode.mutateAsync(pugId);
            if (updated.inviteCode) {
                const url = `${window.location.origin}/i/${updated.inviteCode}`;
                await navigator.clipboard.writeText(url);
                toast.success('New invite link copied to clipboard!');
            }
        } catch (err) {
            toast.error('Failed to regenerate link', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    const handleSubmit = async (data: {
        discordUsername: string;
        role: PugRole;
        class?: string;
        spec?: string;
        notes?: string;
    }) => {
        try {
            if (editingPug) {
                await updatePug.mutateAsync({
                    pugId: editingPug.id,
                    dto: data,
                });
                toast.success(`PUG "${data.discordUsername}" updated`);
            } else {
                await createPug.mutateAsync(data);
                toast.success(`PUG "${data.discordUsername}" added to roster`);
            }
            setShowFormModal(false);
            setEditingPug(null);
        } catch (err) {
            toast.error(editingPug ? 'Failed to update PUG' : 'Failed to add PUG', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    // Don't show section if no PUGs and user can't manage
    if (pugs.length === 0 && !canManage) {
        return null;
    }

    return (
        <div className="rounded-lg border border-edge bg-surface/50 p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <h4 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-secondary">
                    <span className="inline-block h-3 w-3 rounded bg-amber-500" />
                    PUGs (Guest Players)
                    {pugs.length > 0 && (
                        <span className="text-xs font-normal normal-case text-muted">
                            ({pugs.length})
                        </span>
                    )}
                </h4>

                {/* ROK-292: Add PUG button removed — PUG add is now inline in the Assign modal */}
            </div>

            {/* Role composition summary (MMO games only) */}
            {isMMOGame && pugs.length > 0 && Object.keys(pugCountByRole).length > 0 && (
                <div className="flex gap-3 mb-3 text-xs text-muted">
                    {Object.entries(pugCountByRole).map(([role, count]) => (
                        <span key={role}>
                            {formatRole(role)}: {count}
                        </span>
                    ))}
                </div>
            )}

            {/* PUG cards */}
            {isLoading ? (
                <div className="flex items-center justify-center py-4">
                    <span className="text-sm text-muted">Loading PUGs...</span>
                </div>
            ) : pugs.length === 0 ? (
                <div className="flex items-center justify-center py-4 text-sm text-dim">
                    No PUGs added yet
                    {canManage && ' — use the Assign modal to add PUGs'}
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 sm:gap-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                    {pugs.map((pug) => (
                        <PugCard
                            key={pug.id}
                            pug={pug}
                            canManage={canManage}
                            onEdit={handleEdit}
                            onRemove={handleRemove}
                            onRegenerateLink={canManage ? handleRegenerateLink : undefined}
                            showRole={isMMOGame}
                        />
                    ))}
                </div>
            )}

            {/* Add/Edit Modal */}
            <PugFormModal
                isOpen={showFormModal}
                onClose={() => {
                    setShowFormModal(false);
                    setEditingPug(null);
                }}
                editingPug={editingPug}
                onSubmit={handleSubmit}
                isSubmitting={createPug.isPending || updatePug.isPending}
                isMMOGame={isMMOGame}
            />
        </div>
    );
}
