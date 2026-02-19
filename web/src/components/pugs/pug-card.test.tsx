import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PugCard } from './pug-card';
import type { PugSlotResponseDto } from '@raid-ledger/contract';

const createMockPug = (overrides: Partial<PugSlotResponseDto> = {}): PugSlotResponseDto => ({
    id: 'pug-uuid-1',
    eventId: 42,
    discordUsername: 'testplayer',
    discordUserId: null,
    discordAvatarHash: null,
    role: 'dps',
    class: null,
    spec: null,
    notes: null,
    status: 'pending',
    serverInviteUrl: null,
    claimedByUserId: null,
    createdBy: 1,
    createdAt: '2026-02-19T00:00:00Z',
    updatedAt: '2026-02-19T00:00:00Z',
    ...overrides,
});

describe('PugCard', () => {
    describe('basic rendering', () => {
        it('renders Discord username', () => {
            render(<PugCard pug={createMockPug()} />);
            expect(screen.getByText('testplayer')).toBeInTheDocument();
        });

        it('renders Guest badge', () => {
            render(<PugCard pug={createMockPug()} />);
            expect(screen.getByText('Guest')).toBeInTheDocument();
        });

        it('renders status indicator', () => {
            render(<PugCard pug={createMockPug({ status: 'invited' })} />);
            expect(screen.getByText('Invited')).toBeInTheDocument();
        });

        it('renders Pending status', () => {
            render(<PugCard pug={createMockPug({ status: 'pending' })} />);
            expect(screen.getByText('Pending')).toBeInTheDocument();
        });

        it('renders Claimed status', () => {
            render(<PugCard pug={createMockPug({ status: 'claimed' })} />);
            expect(screen.getByText('Claimed')).toBeInTheDocument();
        });

        it('renders notes when provided', () => {
            render(<PugCard pug={createMockPug({ notes: 'Needs summon' })} />);
            expect(screen.getByText('Needs summon')).toBeInTheDocument();
        });

        it('renders class and spec when provided', () => {
            render(
                <PugCard pug={createMockPug({ class: 'Warrior', spec: 'Arms' })} />,
            );
            // Uses bullet separator
            expect(screen.getByText(/Warrior/)).toBeInTheDocument();
            expect(screen.getByText(/Arms/)).toBeInTheDocument();
        });
    });

    describe('role badge', () => {
        it('does not show role badge by default', () => {
            render(<PugCard pug={createMockPug({ role: 'tank' })} />);
            expect(screen.queryByText('Tank')).not.toBeInTheDocument();
        });

        it('shows role badge when showRole is true', () => {
            render(<PugCard pug={createMockPug({ role: 'tank' })} showRole />);
            expect(screen.getByText(/Tank/)).toBeInTheDocument();
        });

        it('shows healer role badge', () => {
            render(<PugCard pug={createMockPug({ role: 'healer' })} showRole />);
            expect(screen.getByText(/Healer/)).toBeInTheDocument();
        });
    });

    describe('server invite link', () => {
        it('shows invite link for pending PUGs with serverInviteUrl when canManage', () => {
            render(
                <PugCard
                    pug={createMockPug({
                        status: 'pending',
                        serverInviteUrl: 'https://discord.gg/test123',
                    })}
                    canManage
                />,
            );

            const link = screen.getByText('Server invite link');
            expect(link).toBeInTheDocument();
            expect(link).toHaveAttribute('href', 'https://discord.gg/test123');
            expect(link).toHaveAttribute('target', '_blank');
        });

        it('does not show invite link when canManage is false', () => {
            render(
                <PugCard
                    pug={createMockPug({
                        status: 'pending',
                        serverInviteUrl: 'https://discord.gg/test123',
                    })}
                />,
            );

            expect(screen.queryByText('Server invite link')).not.toBeInTheDocument();
        });

        it('does not show invite link when status is not pending', () => {
            render(
                <PugCard
                    pug={createMockPug({
                        status: 'invited',
                        serverInviteUrl: 'https://discord.gg/test123',
                    })}
                    canManage
                />,
            );

            expect(screen.queryByText('Server invite link')).not.toBeInTheDocument();
        });

        it('does not show invite link when no serverInviteUrl', () => {
            render(
                <PugCard
                    pug={createMockPug({ status: 'pending', serverInviteUrl: null })}
                    canManage
                />,
            );

            expect(screen.queryByText('Server invite link')).not.toBeInTheDocument();
        });

        it('has a copy button next to the invite link', () => {
            render(
                <PugCard
                    pug={createMockPug({
                        status: 'pending',
                        serverInviteUrl: 'https://discord.gg/test123',
                    })}
                    canManage
                />,
            );

            const copyBtn = screen.getByTitle('Copy invite link');
            expect(copyBtn).toBeInTheDocument();
        });

        it('copies invite URL to clipboard when copy button is clicked', () => {
            const mockWriteText = vi.fn().mockResolvedValue(undefined);
            Object.assign(navigator, {
                clipboard: { writeText: mockWriteText },
            });

            render(
                <PugCard
                    pug={createMockPug({
                        status: 'pending',
                        serverInviteUrl: 'https://discord.gg/test123',
                    })}
                    canManage
                />,
            );

            const copyBtn = screen.getByTitle('Copy invite link');
            fireEvent.click(copyBtn);

            expect(mockWriteText).toHaveBeenCalledWith('https://discord.gg/test123');
        });
    });

    describe('manage actions', () => {
        it('shows action menu button when canManage is true', () => {
            render(<PugCard pug={createMockPug()} canManage />);
            expect(screen.getByLabelText('PUG actions')).toBeInTheDocument();
        });

        it('does not show action menu when canManage is false', () => {
            render(<PugCard pug={createMockPug()} />);
            expect(screen.queryByLabelText('PUG actions')).not.toBeInTheDocument();
        });

        it('shows Edit and Remove options when menu is opened', () => {
            render(<PugCard pug={createMockPug()} canManage />);

            fireEvent.click(screen.getByLabelText('PUG actions'));

            expect(screen.getByText('Edit')).toBeInTheDocument();
            expect(screen.getByText('Remove')).toBeInTheDocument();
        });

        it('calls onEdit when Edit is clicked', () => {
            const onEdit = vi.fn();
            const pug = createMockPug();
            render(<PugCard pug={pug} canManage onEdit={onEdit} />);

            fireEvent.click(screen.getByLabelText('PUG actions'));
            fireEvent.click(screen.getByText('Edit'));

            expect(onEdit).toHaveBeenCalledWith(pug);
        });

        it('calls onRemove when Remove is clicked', () => {
            const onRemove = vi.fn();
            render(
                <PugCard pug={createMockPug()} canManage onRemove={onRemove} />,
            );

            fireEvent.click(screen.getByLabelText('PUG actions'));
            fireEvent.click(screen.getByText('Remove'));

            expect(onRemove).toHaveBeenCalledWith('pug-uuid-1');
        });
    });
});
