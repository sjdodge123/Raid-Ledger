import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { RosterAssignmentResponse } from '@raid-ledger/contract';

interface RosterCardProps {
    id: string;
    item: RosterAssignmentResponse;
    isDraggable: boolean;
    isOverlay?: boolean;
}

/**
 * RosterCard - A draggable card representing a user in the roster (ROK-114).
 */
export function RosterCard({ id, item, isDraggable, isOverlay }: RosterCardProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id,
        disabled: !isDraggable,
    });

    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging && !isOverlay ? 0.5 : 1,
    };

    // Role badge colors
    const roleBadge = item.character?.role ? (
        <span
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${item.character.role === 'tank'
                ? 'bg-blue-600/30 text-blue-300'
                : item.character.role === 'healer'
                    ? 'bg-green-600/30 text-green-300'
                    : 'bg-red-600/30 text-red-300'
                }`}
        >
            {item.character.role.charAt(0).toUpperCase() + item.character.role.slice(1)}
        </span>
    ) : null;

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            className={`
        flex items-center gap-3 rounded-lg border p-2 transition-all
        ${isDraggable
                    ? 'cursor-grab border-slate-600 bg-slate-800 hover:border-slate-500 active:cursor-grabbing'
                    : 'cursor-default border-slate-700 bg-slate-800/50'
                }
        ${isOverlay ? 'shadow-xl ring-2 ring-indigo-500' : ''}
        ${isDragging ? 'z-10' : ''}
      `}
        >
            {/* Avatar */}
            <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-full bg-slate-700">
                {item.avatar ? (
                    <img
                        src={item.avatar}
                        alt={item.username}
                        className="h-full w-full object-cover"
                    />
                ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-slate-400">
                        {item.username.charAt(0).toUpperCase()}
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-slate-200">{item.username}</span>
                    {roleBadge}
                    {item.isOverride && (
                        <span className="rounded bg-yellow-600/30 px-1 py-0.5 text-xs text-yellow-400">
                            Off-spec
                        </span>
                    )}
                </div>
                {item.character && (
                    <p className="truncate text-xs text-slate-400">
                        {item.character.name}
                        {item.character.className && ` • ${item.character.className}`}
                    </p>
                )}
            </div>
        </div>
    );
}
