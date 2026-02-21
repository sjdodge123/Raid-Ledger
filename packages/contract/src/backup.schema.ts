import { z } from 'zod';

export const BackupFileSchema = z.object({
  filename: z.string(),
  type: z.enum(['daily', 'migration']),
  sizeBytes: z.number(),
  createdAt: z.string(),
});

export type BackupFileDto = z.infer<typeof BackupFileSchema>;

export const BackupListResponseSchema = z.object({
  backups: z.array(BackupFileSchema),
  total: z.number(),
});

export type BackupListResponseDto = z.infer<typeof BackupListResponseSchema>;
