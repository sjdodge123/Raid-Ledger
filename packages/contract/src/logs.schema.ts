import { z } from 'zod';

export const LogServiceEnum = z.enum(['api', 'nginx', 'postgresql', 'redis', 'supervisor']);
export type LogService = z.infer<typeof LogServiceEnum>;

export const LogFileSchema = z.object({
  filename: z.string(),
  service: LogServiceEnum,
  sizeBytes: z.number(),
  lastModified: z.string(),
});

export type LogFileDto = z.infer<typeof LogFileSchema>;

export const LogListResponseSchema = z.object({
  files: z.array(LogFileSchema),
  total: z.number(),
});

export type LogListResponseDto = z.infer<typeof LogListResponseSchema>;
