import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api-client';
import type {
  ChannelBindingListDto,
  ChannelBindingDto,
  CreateChannelBindingDto,
  UpdateChannelBindingDto,
} from '@raid-ledger/contract';

const QUERY_KEY = ['admin', 'discord', 'bindings'];

function useBindingMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const createBinding = useMutation<{ data: ChannelBindingDto }, Error, CreateChannelBindingDto>({
    mutationFn: (dto) => fetchApi('/admin/discord/bindings', { method: 'POST', body: JSON.stringify(dto) }),
    onSuccess: invalidate,
  });

  const updateBinding = useMutation<{ data: ChannelBindingDto }, Error, { id: string; dto: UpdateChannelBindingDto }>({
    mutationFn: ({ id, dto }) => fetchApi(`/admin/discord/bindings/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
    onSuccess: invalidate,
  });

  const deleteBinding = useMutation<void, Error, string>({
    mutationFn: (id) => fetchApi(`/admin/discord/bindings/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  return { createBinding, updateBinding, deleteBinding };
}

export function useChannelBindings() {
  const bindings = useQuery<ChannelBindingListDto>({
    queryKey: QUERY_KEY,
    queryFn: () => fetchApi('/admin/discord/bindings'),
    staleTime: 15_000,
  });
  return { bindings, ...useBindingMutations() };
}
