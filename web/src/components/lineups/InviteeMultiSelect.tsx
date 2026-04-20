/**
 * Invitee multi-select for private lineups (ROK-1065).
 *
 * Checkbox list of Discord-linked guild members with a search box —
 * mirrors the `MemberPicker` used in the Schedule a Game poll modal.
 * Parent contract unchanged: controlled `value: number[]` + `onChange`.
 */
import { useMemo, useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPlayers } from '../../lib/api-client';

interface GuildMember {
  id: number;
  username: string;
  discordLinked: boolean;
}

export interface InviteeMultiSelectProps {
  value: number[];
  onChange: (next: number[]) => void;
}

function useGuildMembers(search: string) {
  return useQuery({
    queryKey: ['players', 'invitee-picker', search],
    queryFn: () =>
      getPlayers({
        search: search || undefined,
        page: 1,
        pageSize: 200,
      }),
    select: (data): GuildMember[] =>
      (data.data ?? []).map((u) => ({
        id: u.id,
        username: u.username,
        discordLinked: !!u.discordId,
      })),
  });
}

function MemberRow({
  member,
  checked,
  onToggle,
}: {
  member: GuildMember;
  checked: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <label
      data-testid={`invitee-option-${member.id}`}
      className="flex items-center gap-2 px-3 py-2 hover:bg-panel rounded cursor-pointer"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="rounded border-edge"
      />
      <span className="text-sm text-foreground flex-1">{member.username}</span>
      {!member.discordLinked && (
        <span className="text-[10px] uppercase tracking-wide text-muted">
          No Discord — DMs won't reach them
        </span>
      )}
    </label>
  );
}

/** Guild-member multi-select with search + checkboxes. */
export function InviteeMultiSelect({
  value,
  onChange,
}: InviteeMultiSelectProps): JSX.Element {
  const [search, setSearch] = useState('');
  const { data: members = [], isLoading } = useGuildMembers(search);

  const filtered = useMemo(() => {
    if (!search) return members;
    const q = search.toLowerCase();
    return members.filter((m) => m.username.toLowerCase().includes(q));
  }, [members, search]);

  function toggle(id: number): void {
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id],
    );
  }

  return (
    <div data-testid="invitee-multi-select" className="space-y-2">
      <label
        htmlFor="invitee-search"
        className="block text-sm font-medium text-primary"
      >
        Invitees
      </label>
      <input
        id="invitee-search"
        data-testid="invitee-search"
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search members..."
        aria-label="Search members"
        className="w-full px-3 py-2 text-sm bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-amber-500"
      />
      <div className="max-h-48 overflow-y-auto border border-edge rounded-lg">
        {isLoading && (
          <div className="px-3 py-2 text-sm text-muted">Loading...</div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="px-3 py-2 text-sm text-muted">No members found</div>
        )}
        {filtered.map((m) => (
          <MemberRow
            key={m.id}
            member={m}
            checked={value.includes(m.id)}
            onToggle={() => toggle(m.id)}
          />
        ))}
      </div>
      <p className="text-xs text-muted">
        {value.length > 0
          ? `${value.length} invitee${value.length !== 1 ? 's' : ''} selected`
          : 'Pick at least one guild member. Private lineups require ≥1 invitee.'}
      </p>
    </div>
  );
}
