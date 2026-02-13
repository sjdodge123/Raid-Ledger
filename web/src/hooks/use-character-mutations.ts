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
 * Creating with isMain=true triggers a server-side swap, so invalidate
 * all character-related caches to reflect the new main across views.
 */
export function useCreateCharacter() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (dto: CreateCharacterDto) => createCharacter(dto),
        onSuccess: () => {
            toast.success('Character created!');
            queryClient.invalidateQueries({ queryKey: ['me', 'characters'] });
            queryClient.invalidateQueries({ queryKey: ['characters'] });
            queryClient.invalidateQueries({ queryKey: ['userProfile'] });
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to create character');
        },
    });
}

/**
 * Mutation hook for updating a character.
 * Invalidates all character-related caches since edits may pair with
 * a setMain call that changes isMain across characters.
 */
export function useUpdateCharacter() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, dto }: { id: string; dto: UpdateCharacterDto }) =>
            updateCharacter(id, dto),
        onSuccess: () => {
            toast.success('Character updated!');
            queryClient.invalidateQueries({ queryKey: ['me', 'characters'] });
            queryClient.invalidateQueries({ queryKey: ['characters'] });
            queryClient.invalidateQueries({ queryKey: ['userProfile'] });
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
 * Deleting a main character triggers server-side auto-promote of the
 * next alt, so invalidate all character-related caches.
 */
export function useDeleteCharacter() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => deleteCharacter(id),
        onSuccess: () => {
            toast.success('Character deleted');
            queryClient.invalidateQueries({ queryKey: ['me', 'characters'] });
            queryClient.invalidateQueries({ queryKey: ['characters'] });
            queryClient.invalidateQueries({ queryKey: ['userProfile'] });
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to delete character');
        },
    });
}

