import { useDroppable } from '@dnd-kit/core';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { RosterCard } from './RosterCard';

interface RosterSlotProps {
    id: string;
    role: RosterRole;
    position: number;
    item?: RosterAssignmentResponse;
    color: string;
    isDraggable: boolean;
}

/**
 * RosterSlot - A droppable slot for role-based roster positions (ROK-114).
 */
export function RosterSlot({ id, role, position, item, color, isDraggable }: RosterSlotProps) {
    const { isOver, setNodeRef } = useDroppable({
        id,
        data: { role, position },
    });

    return (
        <div
            ref={setNodeRef}
            className={`
        relative min-h-[60px] rounded-lg border-2 border-dashed transition-all
        ${isOver
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : item
                        ? 'border-transparent bg-slate-800/50'
                        : 'border-slate-600 bg-slate-800/30'
                }
      `}
        >
            {/* Position label */}
            <span
                className={`
          absolute -top-2 left-2 z-10 rounded px-1.5 text-xs font-semibold
          ${color} text-white
        `}
            >
                {position}
            </span>

            {/* Slot content */}
            {item ? (
                <div className="p-1">
                    <RosterCard
                        id={`assignment-${item.signupId}`}
                        item={item}
                        isDraggable={isDraggable}
                    />
                </div>
            ) : (
                <div className="flex h-full min-h-[60px] items-center justify-center">
                    <span className="text-xs text-slate-500">
                        Drop {role} here
                    </span>
                </div>
            )}

            {/* Override warning */}
            {item?.isOverride && (
                <div className="absolute -bottom-1 -right-1 rounded-full bg-yellow-500 p-0.5">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="h-3 w-3 text-slate-900"
                    >
                        <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575L6.457 1.047Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368L8.22 1.754ZM7.25 11a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0Zm.75-5.5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 .75-.75Z" />
                    </svg>
                </div>
            )}
        </div>
    );
}
