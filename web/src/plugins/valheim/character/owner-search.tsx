/** ROK-1836 L4 (D10) — member search for the admin owner picker (`GET /users?search`). */
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Combobox } from '../../../components/ui/combobox';
import { getPlayers } from '../../../lib/api/users-api';

export interface OwnerOption {
    id: number;
    username: string;
}

function useMemberSearch(search: string) {
    return useQuery({
        queryKey: ['players', 'valheim-owner-picker', search],
        queryFn: () =>
            getPlayers({
                ...(search ? { search } : {}),
                page: 1,
                pageSize: 20,
            }),
        select: (res): OwnerOption[] =>
            res.data.map((u) => ({ id: u.id, username: u.username })),
    });
}

interface OwnerSearchProps {
    value: OwnerOption | null;
    onChange: (option: OwnerOption | null) => void;
}

/**
 * Text edits that no longer match the picked member clear the pick, so Assign
 * can't submit a stale owner. The Combobox reports a pick as `onChange(o)`
 * then `onInputChange(label)`; the ref recognises that label as no edit.
 */
function useOwnerText(
    value: OwnerOption | null,
    onChange: (option: OwnerOption | null) => void,
) {
    const [text, setText] = useState('');
    const picked = useRef<OwnerOption | null>(null);
    const pick = (o: OwnerOption | null): void => {
        picked.current = o;
        onChange(o);
    };
    const edit = (s: string): void => {
        setText(s);
        if (s === picked.current?.username) return;
        picked.current = null;
        if (value !== null) onChange(null);
    };
    return { text, pick, edit };
}

export function OwnerSearch({ value, onChange }: OwnerSearchProps) {
    const { text, pick, edit } = useOwnerText(value, onChange);
    const search = useMemberSearch(text.trim());
    return (
        <Combobox<OwnerOption>
            label="Find a member"
            placeholder="Search members"
            options={search.data ?? []}
            getKey={(o) => String(o.id)}
            getLabel={(o) => o.username}
            value={value}
            onChange={pick}
            inputValue={text}
            onInputChange={edit}
            loading={search.isFetching}
            loadingText="Searching…"
            emptyText="No members found"
            openOnFocus
            {...(search.isError
                ? { errorText: "Couldn't search members" }
                : {})}
        />
    );
}
