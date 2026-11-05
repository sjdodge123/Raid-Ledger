/**
 * MemberCombobox — the shared single-member picker (ROK-2095; promoted from
 * the Valheim owner search, ROK-1836). The `Combobox` over `GET /users?search`
 * with an avatar on every row. Used by Valheim "Change owner" and the
 * Admin → Hubs Create / Transfer leader dialogs.
 *
 * Put it inside a `Field` for a visible label: the `label` prop is only an
 * `aria-label` and is never drawn (the ROK-2095 bug).
 */
import { useRef, useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Combobox } from '../ui/combobox';
import { getPlayers } from '../../lib/api/users-api';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';
import { useViewerCacheScope } from '../../hooks/use-auth';
import { AvatarWithFallback } from './AvatarWithFallback';

export interface MemberOption {
    id: number;
    username: string;
    avatarUrl: string | null;
}

function useMemberSearch(search: string) {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: ['players', 'member-combobox', search, viewer],
        queryFn: () => getPlayers({ ...(search ? { search } : {}), page: 1, pageSize: 20 }),
        select: (res): MemberOption[] =>
            res.data.map((u) => ({ id: u.id, username: u.username, avatarUrl: resolveAvatar(toAvatarUser(u)).url })),
    });
}

/**
 * Text edits that no longer match the picked member clear the pick, so a
 * submit can't send a stale member. The Combobox reports a pick as
 * `onChange(o)` then `onInputChange(label)`; the ref recognises that label.
 */
function useMemberText(value: MemberOption | null, onChange: (option: MemberOption | null) => void) {
    const [text, setText] = useState(value?.username ?? '');
    const picked = useRef<MemberOption | null>(value);
    const pick = (o: MemberOption | null): void => {
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

function MemberRow({ member }: { member: MemberOption }): JSX.Element {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="flex-shrink-0">
                <AvatarWithFallback avatarUrl={member.avatarUrl} username={member.username} alt="" sizeClassName="h-6 w-6" />
            </span>
            <span className="truncate">{member.username}</span>
        </span>
    );
}

export interface MemberComboboxProps {
    value: MemberOption | null;
    onChange: (option: MemberOption | null) => void;
    /** Accessible name only — omit inside a `Field`, which draws the label. */
    label?: string;
    placeholder?: string;
}

/** Search-as-you-type single-member picker with avatar rows. */
export function MemberCombobox({ value, onChange, label, placeholder = 'Search members' }: MemberComboboxProps): JSX.Element {
    const { text, pick, edit } = useMemberText(value, onChange);
    const search = useMemberSearch(text.trim());
    return (
        <Combobox<MemberOption>
            label={label} placeholder={placeholder} options={search.data ?? []}
            getKey={(o) => String(o.id)} getLabel={(o) => o.username} renderOption={(o) => <MemberRow member={o} />}
            value={value} onChange={pick} inputValue={text} onInputChange={edit}
            loading={search.isFetching} loadingText="Searching…" emptyText="No members found" openOnFocus
            {...(search.isError ? { errorText: "Couldn't search members" } : {})}
        />
    );
}
