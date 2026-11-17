/**
 * Member multi-select picker for standalone scheduling polls (ROK-977).
 * Displays community members with checkboxes for selection.
 *
 * ROK-2256: the list is page 1 (or a search), so every selected member is
 * also shown by name as a removable chip above it — see `SelectedMembers`.
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPlayers } from '../../lib/api-client';
import { SearchInput } from '../ui/search-input';
import { SelectedMembers } from './member-picker-selected';
import { useMemberNames, type MemberOption } from './member-picker-names';

interface MemberPickerProps {
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  /** ROK-2256: names for selected members the caller already knows (they may not be on page 1). */
  knownMembers?: readonly MemberOption[];
}

const NO_MEMBERS: MemberOption[] = [];

/** Fetch community members for the picker. */
function useCommunityMembers(search: string) {
  return useQuery({
    queryKey: ['players', 'member-picker', search],
    queryFn: () => getPlayers({ ...(search ? { search } : {}), page: 1 }),
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
    <label data-testid={`member-option-${member.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-panel rounded cursor-pointer">
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

/** The page-1 (or search) rows with their checkboxes. */
function MemberList({ members, isLoading, selectedIds, onToggle }: {
  members: MemberOption[]; isLoading: boolean; selectedIds: number[]; onToggle: (id: number) => void;
}) {
  return (
    <div className="max-h-32 overflow-y-auto border border-edge rounded-lg">
      {isLoading && (
        <div className="px-3 py-2 text-sm text-muted">Loading...</div>
      )}
      {!isLoading && members.length === 0 && (
        <div className="px-3 py-2 text-sm text-muted">No members found</div>
      )}
      {members.map((member) => (
        <MemberCheckbox
          key={member.id}
          member={member}
          checked={selectedIds.includes(member.id)}
          onToggle={() => onToggle(member.id)}
        />
      ))}
    </div>
  );
}

/**
 * Multi-select member picker with search.
 * Fetches community members and allows checkbox selection.
 */
export function MemberPicker({ selectedIds, onChange, knownMembers }: MemberPickerProps) {
  const [search, setSearch] = useState('');
  const { data: members = NO_MEMBERS, isLoading } = useCommunityMembers(search);
  const names = useMemberNames(knownMembers, members);

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
      <SelectedMembers ids={selectedIds} names={names} onRemove={toggleMember} />
      <div className="mb-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search members..."
          label="Search members"
        />
      </div>
      <MemberList members={filtered} isLoading={isLoading} selectedIds={selectedIds} onToggle={toggleMember} />
      {selectedIds.length > 0 && (
        <p className="mt-1 text-xs text-muted">
          {selectedIds.length} member{selectedIds.length !== 1 ? 's' : ''} selected
        </p>
      )}
    </div>
  );
}
