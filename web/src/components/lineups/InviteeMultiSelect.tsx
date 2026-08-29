/**
 * Invitee multi-select for community lineups (ROK-1065, ROK-1440).
 *
 * Checkbox list of Discord-linked guild members with a search box —
 * mirrors the `MemberPicker` used in the Schedule a Game poll modal.
 * Parent contract unchanged: controlled `value: number[]` + `onChange`.
 *
 * ROK-1440: `mode` varies only the label + hint copy, because the two
 * visibilities mean different things. On a PRIVATE lineup the list is an
 * access gate (required, ≥1). On a PUBLIC lineup it is a seed list —
 * optional, and adding people never stops anyone else from joining.
 * Defaults to 'private' so pre-existing callers are unchanged.
 */
import { useMemo, useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPlayers } from '../../lib/api-client';

interface GuildMember {
  id: number;
  username: string;
  discordLinked: boolean;
}

export type InviteeMultiSelectMode = 'private' | 'public';

export interface InviteeMultiSelectProps {
  value: number[];
  onChange: (next: number[]) => void;
  /** Copy variant — see file docstring. Defaults to 'private'. */
  mode?: InviteeMultiSelectMode;
}

/** Field label per mode. */
function modeLabel(mode: InviteeMultiSelectMode): string {
  return mode === 'public' ? 'Invite members (optional)' : 'Invitees';
}

/** Empty-state hint per mode. */
function modeHint(mode: InviteeMultiSelectMode): string {
  return mode === 'public'
    ? 'Optional — pull in members you know are playing. Anyone else can still see and join.'
    : 'Pick at least one guild member. Private lineups require ≥1 invitee.';
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
      {/* TD-2: spec asked for "No Steam linked — limited data"; implementing
          that requires adding `steamLinked` to GetPlayersResponseDto. Tracked
          as follow-up. */}
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
  mode = 'private',
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
        {modeLabel(mode)}
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
          : modeHint(mode)}
      </p>
    </div>
  );
}
