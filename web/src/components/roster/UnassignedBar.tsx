import type React from 'react';
import type { RosterAssignmentResponse } from '@raid-ledger/contract';
import { AvatarWithFallback } from '../shared/AvatarWithFallback';
import { toAvatarUser } from '../../lib/avatar';
import './UnassignedBar.css';

interface UnassignedBarProps {
    pool: RosterAssignmentResponse[];
    /** ROK-466: Optional — only admins should open the assignment popup */
    onBarClick?: () => void;
    /** When true, disables own sticky positioning (parent handles it) */
    inline?: boolean;
}

/**
 * UnassignedBar - Thin sticky bar showing unassigned players (ROK-208).
 * Replaces SignupPoolSubmenu. Click opens AssignmentPopup in browse mode.
 */
export function UnassignedBar({ pool, onBarClick, inline }: UnassignedBarProps) {
    const inlineStyle = inline ? { position: 'static' as const, zIndex: 'auto' as const } : undefined;
    const sorted = [...pool].sort((a, b) =>
        a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }),
    );

    if (pool.length === 0) {
        return (
            <div className="unassigned-bar unassigned-bar--empty" style={inlineStyle}>
                <span className="unassigned-bar__check">All players assigned ✓</span>
            </div>
        );
    }

    return (
        <div
            className={`unassigned-bar${onBarClick ? '' : ' unassigned-bar--readonly'}`}
            style={inlineStyle}
            {...(onBarClick ? {
                onClick: onBarClick,
                onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') onBarClick(); },
                role: 'button',
                tabIndex: 0,
                'aria-label': `${pool.length} unassigned players. Click to view.`,
            } : {
                'aria-label': `${pool.length} unassigned players.`,
            })}
        >
            <span className="unassigned-bar__label">Unassigned</span>
            <div className="unassigned-bar__avatars">
                {sorted.slice(0, 6).map((item, i) => (
                    <div
                        key={item.signupId}
                        className="unassigned-bar__avatar"
                        style={{ marginLeft: i > 0 ? '-8px' : 0, zIndex: pool.length - i }}
                    >
                        <AvatarWithFallback
                            user={toAvatarUser({ ...item, id: item.userId })}
                            username={item.username}
                            sizeClassName="h-6 w-6"
                        />
                    </div>
                ))}
                {pool.length > 6 && (
                    <span className="unassigned-bar__overflow">+{pool.length - 6}</span>
                )}
            </div>
            <span className="unassigned-bar__count">{pool.length}</span>
        </div>
    );
}
