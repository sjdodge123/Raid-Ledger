/**
 * Member multi-select picker for standalone scheduling polls (ROK-977).
 * Displays community members with checkboxes for selection.
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPlayers } from '../../lib/api-client';

interface MemberOption {
  id: number;
  username: string;
}

interface MemberPickerProps {
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}

/** Fetch community members for the picker. */
function useCommunityMembers(search: string) {
  return useQuery({
    queryKey: ['players', 'member-picker', search],
    queryFn: () => getPlayers({ search: search || undefined, page: 1 }),
    select: (data) =>
      (data.data ?? []).map((u) => ({
        id: u.id,
        username: u.username,
      })),
  });
}

function MemberCheckbox({ member, checked, onToggle }: {
  member: MemberOption; checked: boolean; onToggle: () => void;
}) {
  return (
    <label className="flex items-center gap-2 px-3 py-2 hover:bg-panel rounded cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="rounded border-edge"
      />
      <span className="text-sm text-foreground">{member.username}</span>
    </label>
  );
}

/**
 * Multi-select member picker with search.
 * Fetches community members and allows checkbox selection.
 */
export function MemberPicker({ selectedIds, onChange }: MemberPickerProps) {
  const [search, setSearch] = useState('');
  const { data: members = [], isLoading } = useCommunityMembers(search);

  const toggleMember = (id: number) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((sid) => sid !== id)
      : [...selectedIds, id];
    onChange(next);
  };

  const filtered = useMemo(
    () =>
      search
        ? members.filter((m) =>
            m.username.toLowerCase().includes(search.toLowerCase()),
          )
        : members,
    [members, search],
  );

  return (
    <div data-testid="member-picker">
      <label className="block text-sm font-medium text-secondary mb-2">
        Members (optional)
      </label>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search members..."
        aria-label="Search members"
        className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-sm text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-2"
      />
      <div className="max-h-40 overflow-y-auto border border-edge rounded-lg">
        {isLoading && (
          <div className="px-3 py-2 text-sm text-muted">Loading...</div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="px-3 py-2 text-sm text-muted">No members found</div>
        )}
        {filtered.map((member) => (
          <MemberCheckbox
            key={member.id}
            member={member}
            checked={selectedIds.includes(member.id)}
            onToggle={() => toggleMember(member.id)}
          />
        ))}
      </div>
      {selectedIds.length > 0 && (
        <p className="mt-1 text-xs text-muted">
          {selectedIds.length} member{selectedIds.length !== 1 ? 's' : ''} selected
        </p>
      )}
    </div>
  );
}
