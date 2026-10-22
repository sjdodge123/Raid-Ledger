import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api-client';
import type {
  ChannelBindingListDto,
  ChannelBindingDto,
  CreateChannelBindingDto,
  UpdateChannelBindingDto,
} from '@raid-ledger/contract';
import { LIFECYCLE_ACTIVITY_KEY } from './admin/use-channel-lifecycle';

const QUERY_KEY = ['admin', 'discord', 'bindings'];

function useBindingMutations() {
  const queryClient = useQueryClient();
  // ROK-1428: a pin / edit / delete also changes the lifecycle preview's binding column.
  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: LIFECYCLE_ACTIVITY_KEY }),
  ]);

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
