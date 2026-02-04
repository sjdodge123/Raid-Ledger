import { Test, TestingModule } from '@nestjs/testing';
import {
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

describe('AvailabilityService', () => {
    let service: AvailabilityService;
    let mockDb: Record<string, jest.Mock>;

    const mockAvailability = {
        id: 'avail-uuid-1',
        userId: 1,
        timeRange: [new Date('2026-02-05T18:00:00Z'), new Date('2026-02-05T22:00:00Z')] as [Date, Date],
        status: 'available' as const,
        gameId: null,
        sourceEventId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const mockCommittedAvailability = {
        ...mockAvailability,
        id: 'avail-uuid-2',
        status: 'committed' as const,
        timeRange: [new Date('2026-02-05T19:00:00Z'), new Date('2026-02-05T21:00:00Z')] as [Date, Date],
    };

    beforeEach(async () => {
        mockDb = {
            select: jest.fn(),
            insert: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        };

        // Default select chain
        const selectChain = {
            from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue([mockAvailability]),
                    orderBy: jest.fn().mockResolvedValue([mockAvailability]),
                }),
                orderBy: jest.fn().mockResolvedValue([mockAvailability]),
            }),
        };
        mockDb.select.mockReturnValue(selectChain);

        // Default insert chain
        const insertChain = {
            values: jest.fn().mockReturnValue({
                returning: jest.fn().mockResolvedValue([mockAvailability]),
            }),
        };
        mockDb.insert.mockReturnValue(insertChain);

        // Default update chain
        const updateChain = {
            set: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                    returning: jest.fn().mockResolvedValue([mockAvailability]),
                }),
            }),
        };
        mockDb.update.mockReturnValue(updateChain);

        // Default delete chain
        const deleteChain = {
            where: jest.fn().mockResolvedValue(undefined),
        };
        mockDb.delete.mockReturnValue(deleteChain);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AvailabilityService,
                { provide: DrizzleAsyncProvider, useValue: mockDb },
            ],
        }).compile();

        service = module.get<AvailabilityService>(AvailabilityService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('findAllForUser', () => {
        it('should return all availability windows for a user', async () => {
            const result = await service.findAllForUser(1);

            expect(result.data).toHaveLength(1);
            expect(result.meta.total).toBe(1);
            expect(mockDb.select).toHaveBeenCalled();
        });

        it('should return empty list when user has no windows', async () => {
            mockDb.select.mockReturnValueOnce({
                from: jest.fn().mockReturnValue({
                    where: jest.fn().mockReturnValue({
                        orderBy: jest.fn().mockResolvedValue([]),
                    }),
                }),
            });

            const result = await service.findAllForUser(1);

            expect(result.data).toHaveLength(0);
            expect(result.meta.total).toBe(0);
        });
    });

    describe('findOne', () => {
        it('should return an availability window when found and owned', async () => {
            const result = await service.findOne(1, 'avail-uuid-1');

            expect(result.id).toBe(mockAvailability.id);
            expect(result.status).toBe('available');
        });

        it('should throw NotFoundException when window not found', async () => {
            mockDb.select.mockReturnValueOnce({
                from: jest.fn().mockReturnValue({
                    where: jest.fn().mockReturnValue({
                        limit: jest.fn().mockResolvedValue([]),
                    }),
                }),
            });

            await expect(service.findOne(1, 'nonexistent')).rejects.toThrow(
                NotFoundException,
            );
        });

        it('should throw ForbiddenException when not owned by user', async () => {
            await expect(service.findOne(999, 'avail-uuid-1')).rejects.toThrow(
                ForbiddenException,
            );
        });
    });

    describe('create', () => {
        it('should create an availability window', async () => {
            // Mock conflict check returns empty (no conflicts)
            mockDb.select
                .mockReturnValueOnce({
                    from: jest.fn().mockReturnValue({
                        where: jest.fn().mockResolvedValue([]),
                    }),
                });

            const dto = {
                startTime: '2026-02-05T18:00:00Z',
                endTime: '2026-02-05T22:00:00Z',
                status: 'available' as const,
            };

            const result = await service.create(1, dto);

            expect(result.id).toBe(mockAvailability.id);
            expect(mockDb.insert).toHaveBeenCalled();
        });

        it('should return conflicts when overlapping committed window exists', async () => {
            // Mock conflict check returns a committed window
            mockDb.select
                .mockReturnValueOnce({
                    from: jest.fn().mockReturnValue({
                        where: jest.fn().mockResolvedValue([mockCommittedAvailability]),
                    }),
                });

            const dto = {
                startTime: '2026-02-05T18:00:00Z',
                endTime: '2026-02-05T22:00:00Z',
                status: 'available' as const,
            };

            const result = await service.create(1, dto);

            expect(result.conflicts).toBeDefined();
            expect(result.conflicts).toHaveLength(1);
            expect(result.conflicts![0].status).toBe('committed');
        });
    });

    describe('update', () => {
        it('should update an availability window', async () => {
            // Mock conflict check returns empty
            mockDb.select
                .mockReturnValueOnce({
                    from: jest.fn().mockReturnValue({
                        where: jest.fn().mockReturnValue({
                            limit: jest.fn().mockResolvedValue([mockAvailability]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: jest.fn().mockReturnValue({
                        where: jest.fn().mockResolvedValue([]),
                    }),
                });

            const dto = { status: 'blocked' as const };

            const result = await service.update(1, 'avail-uuid-1', dto);

            expect(result.id).toBe(mockAvailability.id);
            expect(mockDb.update).toHaveBeenCalled();
        });
    });

    describe('delete', () => {
        it('should delete an availability window', async () => {
            await service.delete(1, 'avail-uuid-1');

            expect(mockDb.delete).toHaveBeenCalled();
        });
    });

    describe('checkConflicts', () => {
        it('should return empty array when no conflicts', async () => {
            mockDb.select.mockReturnValueOnce({
                from: jest.fn().mockReturnValue({
                    where: jest.fn().mockResolvedValue([]),
                }),
            });

            const conflicts = await service.checkConflicts(
                1,
                '2026-02-05T18:00:00Z',
                '2026-02-05T22:00:00Z',
            );

            expect(conflicts).toHaveLength(0);
        });

        it('should return conflicts for overlapping committed windows', async () => {
            mockDb.select.mockReturnValueOnce({
                from: jest.fn().mockReturnValue({
                    where: jest.fn().mockResolvedValue([mockCommittedAvailability]),
                }),
            });

            const conflicts = await service.checkConflicts(
                1,
                '2026-02-05T18:00:00Z',
                '2026-02-05T22:00:00Z',
            );

            expect(conflicts).toHaveLength(1);
            expect(conflicts[0].status).toBe('committed');
        });

        it('should exclude self when excludeId is provided', async () => {
            mockDb.select.mockReturnValueOnce({
                from: jest.fn().mockReturnValue({
                    where: jest.fn().mockResolvedValue([mockCommittedAvailability]),
                }),
            });

            const conflicts = await service.checkConflicts(
                1,
                '2026-02-05T18:00:00Z',
                '2026-02-05T22:00:00Z',
                undefined,
                'avail-uuid-2', // Exclude the committed window
            );

            expect(conflicts).toHaveLength(0);
        });
    });
});
