/**
 * ROK-2212 — `CreatePollModal.initialMemberUserIds`: a caller that already
 * knows who the poll is for (a Forever suggested group) seeds the member list
 * once per open. The seed is the form's baseline, so an untouched pre-filled
 * form is not "dirty" and closing it never asks "Discard your changes?".
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Same ids, same order. */
export function sameIds(a: readonly number[], b: readonly number[]): boolean {
    return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Calls `seed(ids)` once each time the modal opens with a non-empty `ids`; later prop changes never re-seed. */
export function useSeedMembersOnOpen(isOpen: boolean, ids: number[] | undefined, seed: (ids: number[]) => void): void {
    const seeded = useRef(false);
    useEffect(() => {
        if (!isOpen) {
            seeded.current = false;
            return;
        }
        if (seeded.current || ids === undefined || ids.length === 0) return;
        seeded.current = true;
        seed(ids);
    }, [isOpen, ids, seed]);
}

/** The seeded members — the form's clean state — and the seeder (sets the members + threshold via `setMemberIds`). */
export function useMemberBaseline(setMemberIds: (ids: number[]) => void): {
    baseMembers: number[];
    setBaseMembers: (ids: number[]) => void;
    seedMembers: (ids: number[]) => void;
} {
    const [baseMembers, setBaseMembers] = useState<number[]>([]);
    const seedMembers = useCallback((ids: number[]) => {
        setBaseMembers(ids);
        setMemberIds(ids);
    }, [setMemberIds]);
    return { baseMembers, setBaseMembers, seedMembers };
}
