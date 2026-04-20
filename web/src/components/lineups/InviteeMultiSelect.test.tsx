/**
 * Tests for InviteeMultiSelect (ROK-1065).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InviteeMultiSelect } from './InviteeMultiSelect';

vi.mock('../../lib/api-client', () => ({
  getPlayers: vi.fn(),
}));

import { getPlayers } from '../../lib/api-client';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

const makeResponse = (
  members: Array<{ id: number; username: string; discordId: string | null }>,
) => ({
  data: members.map((m) => ({
    id: m.id,
    username: m.username,
    avatar: null,
    discordId: m.discordId,
  })),
  meta: { total: members.length, page: 1, pageSize: 20, hasMore: false },
});

describe('InviteeMultiSelect', () => {
  beforeEach(() => {
    vi.mocked(getPlayers).mockReset();
  });

  it('renders every guild member and flags non-Discord-linked rows', async () => {
    vi.mocked(getPlayers).mockResolvedValue(
      makeResponse([
        { id: 1, username: 'alice', discordId: 'd-1' },
        { id: 2, username: 'bob', discordId: null },
        { id: 3, username: 'carol', discordId: 'd-3' },
      ]),
    );

    renderWithClient(<InviteeMultiSelect value={[]} onChange={() => {}} />);

    expect(await screen.findByTestId('invitee-option-1')).toBeInTheDocument();
    expect(screen.getByTestId('invitee-option-2')).toBeInTheDocument();
    expect(screen.getByTestId('invitee-option-3')).toBeInTheDocument();
    expect(
      screen.getByTestId('invitee-option-2').textContent,
    ).toMatch(/No Discord/i);
  });

  it('toggles selection via checkbox and invokes onChange with the new id array', async () => {
    vi.mocked(getPlayers).mockResolvedValue(
      makeResponse([
        { id: 11, username: 'dan', discordId: 'd-11' },
        { id: 12, username: 'eve', discordId: 'd-12' },
      ]),
    );
    const onChange = vi.fn();

    renderWithClient(
      <InviteeMultiSelect value={[11]} onChange={onChange} />,
    );

    const row12 = await screen.findByTestId('invitee-option-12');
    fireEvent.click(row12.querySelector('input[type="checkbox"]')!);
    expect(onChange).toHaveBeenCalledWith([11, 12]);

    const row11 = screen.getByTestId('invitee-option-11');
    fireEvent.click(row11.querySelector('input[type="checkbox"]')!);
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('renders the selection count hint when at least one invitee is picked', async () => {
    vi.mocked(getPlayers).mockResolvedValue(
      makeResponse([{ id: 7, username: 'frank', discordId: 'd-7' }]),
    );

    renderWithClient(<InviteeMultiSelect value={[7]} onChange={() => {}} />);

    expect(await screen.findByText(/1 invitee selected/i)).toBeInTheDocument();
  });
});
