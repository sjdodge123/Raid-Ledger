import { useQuery } from '@tanstack/react-query';
import type { LogListResponseDto, LogService } from '@raid-ledger/contract';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';

const getHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${getAuthToken() || ''}`,
});

export function useLogs(service?: LogService) {
  const logs = useQuery<LogListResponseDto>({
    queryKey: ['admin', 'logs', service ?? 'all'],
    queryFn: async () => {
      const params = service ? `?service=${service}` : '';
      const response = await fetch(`${API_BASE_URL}/admin/logs${params}`, {
        headers: getHeaders(),
      });
      if (!response.ok) throw new Error('Failed to fetch logs');
      return response.json();
    },
    enabled: !!getAuthToken(),
    staleTime: 15_000,
  });

  return { logs };
}

/**
 * The filename the server chose in `Content-Disposition` (ROK-1164: a `.gz`
 * rotated generation is served decompressed under its name minus `.gz`).
 * The server owns that rule; this only reads it back.
 */
export function filenameFromDisposition(header: string | null): string | null {
  const match = header ? /filename="([^"]+)"/.exec(header) : null;
  return match ? match[1] : null;
}

export async function downloadLogFile(filename: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/admin/logs/${encodeURIComponent(filename)}`,
    { headers: { Authorization: `Bearer ${getAuthToken() || ''}` } },
  );
  if (!response.ok) throw new Error('Failed to download log file');

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    filenameFromDisposition(response.headers.get('Content-Disposition')) ??
    filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportLogs(options?: {
  service?: LogService;
  files?: string[];
}): Promise<void> {
  const params = new URLSearchParams();
  if (options?.service) params.set('service', options.service);
  if (options?.files?.length) params.set('files', options.files.join(','));

  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE_URL}/admin/logs/export${query}`, {
    headers: { Authorization: `Bearer ${getAuthToken() || ''}` },
  });
  if (!response.ok) throw new Error('Failed to export logs');

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.download = `logs-${timestamp}.tar.gz`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
