import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '../lib/toast';
import {
    createCharacter,
    updateCharacter,
    setMainCharacter,
    deleteCharacter,
} from '../lib/api-client';
import type { CreateCharacterDto, UpdateCharacterDto } from '@raid-ledger/contract';

/**
 * Mutation hook for creating a character.
 */
export function useCreateCharacter() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (dto: CreateCharacterDto) => createCharacter(dto),
        onSuccess: () => {
            toast.success('Character created!');
            queryClient.invalidateQueries({ queryKey: ['me', 'characters'] });
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to create character');
        },
    });
}

/**
 * Mutation hook for updating a character.
 */
export function useUpdateCharacter() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, dto }: { id: string; dto: UpdateCharacterDto }) =>
            updateCharacter(id, dto),
        onSuccess: (_data, variables) => {
            toast.success('Character updated!');
            queryClient.invalidateQueries({ queryKey: ['me', 'characters'] });
            queryClient.invalidateQueries({ queryKey: ['characters', variables.id] });
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to update character');
        },
    });
}

/**
 * Mutation hook for setting a character as main.
 * Invalidates all caches that display character isMain state:
 *  - ['me', 'characters'] — profile characters list
 *  - ['characters']       — individual character detail pages
 *  - ['userProfile']      — public user profile (embeds characters)
 */
export function useSetMainCharacter() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => setMainCharacter(id),
        onSuccess: () => {
            toast.success('Main character updated!');
            queryClient.invalidateQueries({ queryKey: ['me', 'characters'] });
            queryClient.invalidateQueries({ queryKey: ['characters'] });
            queryClient.invalidateQueries({ queryKey: ['userProfile'] });
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to set main character');
        },
    });
}

/**
 * Mutation hook for deleting a character.
 */
export function useDeleteCharacter() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => deleteCharacter(id),
        onSuccess: () => {
            toast.success('Character deleted');
            queryClient.invalidateQueries({ queryKey: ['me', 'characters'] });
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to delete character');
        },
    });
}

