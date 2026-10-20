/**
 * ROK-1870 §3.1 / design-system §4.14 — the two shells of a community member
 * row's "Manage" menu, chosen by `DESKTOP_MQ` in `CommunityMemberActions`:
 * a `role="menu"` dropdown from 1024px up (focus moves to the first item,
 * arrows wrap, Home / End jump, Esc and an outside click close it back to the
 * trigger) and a `BottomSheet` of 52px rows below it. Both render the same
 * {@link MemberMenuRows}, so labels, testids and gates never diverge.
 */
import { useRef, useState, type JSX, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../ui/button';
import { BottomSheet } from '../../ui/bottom-sheet';
import { useAnchoredPopup } from '../../ui/use-anchored-popup';
import { useMenuOpenState } from '../../lineups/use-menu-open-state';
import { onMenuKeyDown, useFocusFirstItem } from '../../lineups/cycle-4/scheduling-menu-keys';
import type { CommunityRowAction } from './community-access';

const LABEL: Record<CommunityRowAction, string> = {
    remove: 'Remove', ban: 'Ban…', 'make-officer': 'Make officer', 'make-member': 'Make member', 'make-leader': 'Make leader',
};

/** What both shells need: the row's name, its allowed actions and the pick handler. */
export interface MemberMenuProps {
    name: string;
    actions: readonly CommunityRowAction[];
    disabled: boolean;
    onPick: (action: CommunityRowAction) => void;
}

function MemberMenuRows({ actions, onPick, rowClass }: Pick<MemberMenuProps, 'actions' | 'onPick'> & { rowClass: string }): JSX.Element {
    return (
        <>
            {actions.map((a) => (
                <Button key={a} variant="ghost" size="sm" role="menuitem" data-testid={`community-member-${a}`} onClick={() => onPick(a)}
                    className={`justify-start ${rowClass} ${a === 'remove' || a === 'ban' ? 'text-danger' : 'text-secondary'}`}>{LABEL[a]}</Button>
            ))}
        </>
    );
}

interface PopoverProps extends Omit<MemberMenuProps, 'disabled'> {
    anchorRef: RefObject<HTMLButtonElement | null>;
    onClose: (restoreFocus: boolean) => void;
}

/**
 * Portalled to `<body>` and `fixed` under the trigger (`useAnchoredPopup`, the
 * Combobox / notify-bell pattern): the members table is an `overflow-x-auto`
 * scroller, which clipped an in-flow popover on the last row (verify lane 2).
 */
function DropdownPopover({ name, actions, onPick, anchorRef, onClose }: PopoverProps): JSX.Element {
    const menuRef = useRef<HTMLDivElement>(null);
    useFocusFirstItem(menuRef, true);
    const pos = useAnchoredPopup(anchorRef, menuRef, true, () => onClose(false), 'end');
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
        if (e.key === 'Escape') onClose(true);
        else onMenuKeyDown(e);
    };
    return createPortal(
        <div ref={menuRef} role="menu" aria-label={`Manage ${name}`} onKeyDown={onKeyDown} style={{ top: pos?.top ?? 0, left: pos?.left ?? 0 }}
            className="fixed z-50 flex w-44 flex-col overflow-hidden rounded-lg border border-edge bg-surface py-1 shadow-xl">
            <MemberMenuRows actions={actions} onPick={onPick} rowClass="rounded-none" />
        </div>,
        document.body,
    );
}

/** ≥1024px: a 36px trigger and an anchored, portalled `role="menu"` popover. */
export function MemberManageDropdown({ name, actions, disabled, onPick }: MemberMenuProps): JSX.Element {
    const triggerRef = useRef<HTMLButtonElement>(null);
    // The popover owns outside-press + Escape: it lives outside `containerRef`, so the hook's own listener would close it on every item press.
    const { isOpen, open, close, containerRef } = useMenuOpenState(false, triggerRef);
    const pick = (a: CommunityRowAction): void => { close({ restoreFocus: true }); onPick(a); };
    return (
        <div className="relative inline-flex" ref={containerRef}>
            <Button ref={triggerRef} variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={isOpen} disabled={disabled}
                aria-label={`Manage ${name}`} data-testid="community-member-manage" onClick={() => (isOpen ? close() : open())}>Manage</Button>
            {isOpen && <DropdownPopover name={name} actions={actions} onPick={pick} anchorRef={triggerRef}
                onClose={(restoreFocus) => close({ restoreFocus })} />}
        </div>
    );
}

/** <1024px: the trigger opens a `BottomSheet` of 52px rows. */
export function MemberManageSheet({ name, actions, disabled, onPick }: MemberMenuProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const pick = (a: CommunityRowAction): void => { setOpen(false); onPick(a); };
    return (
        <>
            <Button variant="ghost" size="sm" aria-haspopup="dialog" aria-expanded={open} disabled={disabled}
                aria-label={`Manage ${name}`} data-testid="community-member-manage" onClick={() => setOpen(true)}>Manage</Button>
            {open && <BottomSheet isOpen onClose={() => setOpen(false)} title={`Manage ${name}`}>
                <div role="menu" aria-label={`Manage ${name}`} onKeyDown={onMenuKeyDown} className="flex flex-col gap-1">
                    <MemberMenuRows actions={actions} onPick={pick} rowClass="min-h-[52px] w-full text-sm" />
                </div>
            </BottomSheet>}
        </>
    );
}
