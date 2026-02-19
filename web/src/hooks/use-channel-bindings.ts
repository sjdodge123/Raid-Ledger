import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api-client';
import type {
  ChannelBindingListDto,
  ChannelBindingDto,
  CreateChannelBindingDto,
  UpdateChannelBindingDto,
} from '@raid-ledger/contract';

const QUERY_KEY = ['admin', 'discord', 'bindings'];

export function useChannelBindings() {
  const queryClient = useQueryClient();

  const bindings = useQuery<ChannelBindingListDto>({
    queryKey: QUERY_KEY,
    queryFn: () => fetchApi('/admin/discord/bindings'),
    staleTime: 15_000,
  });

  const createBinding = useMutation<
    { data: ChannelBindingDto },
    Error,
    CreateChannelBindingDto
  >({
    mutationFn: (dto) =>
      fetchApi('/admin/discord/bindings', {
        method: 'POST',
        body: JSON.stringify(dto),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const updateBinding = useMutation<
    { data: ChannelBindingDto },
    Error,
    { id: string; dto: UpdateChannelBindingDto }
  >({
    mutationFn: ({ id, dto }) =>
      fetchApi(`/admin/discord/bindings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const deleteBinding = useMutation<void, Error, string>({
    mutationFn: (id) =>
      fetchApi(`/admin/discord/bindings/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  return {
    bindings,
    createBinding,
    updateBinding,
    deleteBinding,
  };
}
