/** ROK-1836 L4 (D10) — member search for the admin owner picker (`GET /users?search`). */
import { useState } from 'react';
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

export function OwnerSearch({ value, onChange }: OwnerSearchProps) {
    const [text, setText] = useState('');
    const search = useMemberSearch(text.trim());
    return (
        <Combobox<OwnerOption>
            label="Find a member"
            placeholder="Search members"
            options={search.data ?? []}
            getKey={(o) => String(o.id)}
            getLabel={(o) => o.username}
            value={value}
            onChange={onChange}
            inputValue={text}
            onInputChange={setText}
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
