/**
 * PugCard - Display card for a PUG player in the roster (ROK-262).
 * Distinguished from regular signups with a "Guest" badge and outlined border.
 * Shows Discord username, role, and generated avatar.
 */
import { useState } from 'react';
import type { PugSlotResponseDto } from '@raid-ledger/contract';
import { PugAvatar } from './pug-avatar';
import { ROLE_BADGE_CLASSES, ROLE_EMOJI, formatRole } from '../../lib/role-colors';

/** Status indicator colors */
const STATUS_COLORS: Record<string, { dot: string; label: string }> = {
    pending: { dot: 'bg-gray-400', label: 'Pending' },
    invited: { dot: 'bg-blue-400', label: 'Invited' },
    accepted: { dot: 'bg-emerald-400', label: 'Accepted' },
    claimed: { dot: 'bg-green-400', label: 'Claimed' },
};

interface PugCardProps {
    pug: PugSlotResponseDto;
    /** Whether the current user can edit/remove this PUG */
    canManage?: boolean;
    /** Called when edit is clicked */
    onEdit?: (pug: PugSlotResponseDto) => void;
    /** Called when remove is clicked */
    onRemove?: (pugId: string) => void;
    /** Whether to display the role badge (only for MMO games) */
    showRole?: boolean;
}

export function PugCard({ pug, canManage = false, onEdit, onRemove, showRole = false }: PugCardProps) {
    const [showMenu, setShowMenu] = useState(false);
    const statusInfo = STATUS_COLORS[pug.status] ?? STATUS_COLORS.pending;

    return (
        <div className="relative flex items-center gap-3 rounded-lg border border-dashed border-amber-500/40 bg-amber-900/10 p-2.5 transition-all">
            {/* Avatar */}
            <PugAvatar
                username={pug.discordUsername}
                discordUserId={pug.discordUserId}
                discordAvatarHash={pug.discordAvatarHash}
                sizeClassName="h-8 w-8"
            />

            {/* Info */}
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span
                        className="truncate font-medium text-foreground"
                        title={pug.discordUsername}
                    >
                        {pug.discordUsername}
                    </span>

                    {/* Guest badge */}
                    <span className="shrink-0 rounded-full bg-amber-600/30 px-2 py-0.5 text-xs font-medium text-amber-300">
                        Guest
                    </span>

                    {/* Role badge (MMO games only) */}
                    {showRole && (
                        <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${ROLE_BADGE_CLASSES[pug.role] ?? ''}`}
                        >
                            {ROLE_EMOJI[pug.role] ?? ''} {formatRole(pug.role)}
                        </span>
                    )}
                </div>

                {/* Secondary info: class/spec and status */}
                <div className="flex items-center gap-2 text-xs text-muted">
                    {(pug.class || pug.spec) && (
                        <span className="truncate">
                            {[pug.class, pug.spec].filter(Boolean).join(' \u2022 ')}
                        </span>
                    )}
                    {/* Status dot */}
                    <span className="flex items-center gap-1 shrink-0">
                        <span className={`inline-block h-2 w-2 rounded-full ${statusInfo.dot}`} />
                        <span>{statusInfo.label}</span>
                    </span>
                </div>

                {/* Notes */}
                {pug.notes && (
                    <p className="mt-0.5 truncate text-xs text-dim" title={pug.notes}>
                        {pug.notes}
                    </p>
                )}

                {/* Server invite URL (shown to managers when PUG is not yet in server) */}
                {canManage && pug.serverInviteUrl && pug.status === 'pending' && (
                    <div className="mt-1 flex items-center gap-1.5">
                        <a
                            href={pug.serverInviteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:text-blue-300 underline truncate"
                            title="Share this invite link with the PUG player"
                        >
                            Server invite link
                        </a>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                void navigator.clipboard.writeText(pug.serverInviteUrl!);
                            }}
                            className="shrink-0 text-xs text-dim hover:text-foreground transition-colors"
                            title="Copy invite link"
                        >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                        </button>
                    </div>
                )}
            </div>

            {/* Manage dropdown */}
            {canManage && (
                <div className="relative shrink-0">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowMenu(!showMenu);
                        }}
                        className="flex items-center justify-center w-11 h-11 rounded text-dim hover:bg-panel hover:text-foreground transition-colors"
                        aria-label="PUG actions"
                    >
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                        </svg>
                    </button>

                    {showMenu && (
                        <>
                            {/* Click-away overlay */}
                            <div
                                className="fixed inset-0 z-40"
                                onClick={() => setShowMenu(false)}
                            />
                            <div className="absolute right-0 top-8 z-50 w-32 rounded-lg border border-edge bg-surface shadow-lg">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowMenu(false);
                                        onEdit?.(pug);
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-panel transition-colors rounded-t-lg"
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowMenu(false);
                                        onRemove?.(pug.id);
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 transition-colors rounded-b-lg"
                                >
                                    Remove
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
