import { useState } from 'react';
import type { LogService } from '@raid-ledger/contract';
import { useLogs, downloadLogFile, exportLogs } from '../../hooks/use-logs';
import { useTimezoneStore } from '../../stores/timezone-store';
import { toast } from 'sonner';

type FilterService = 'all' | LogService;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string, tz: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

const SERVICE_BADGE: Record<string, string> = {
  api: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  nginx: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  postgresql: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  redis: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
};

const SERVICES: LogService[] = ['api', 'nginx', 'postgresql', 'redis'];

export function LogsPanel() {
  const { logs } = useLogs();
  const tz = useTimezoneStore((s) => s.resolved);
  const [filter, setFilter] = useState<FilterService>('all');
  const [exporting, setExporting] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const allFiles = logs.data?.files ?? [];
  const filtered =
    filter === 'all'
      ? allFiles
      : allFiles.filter((f) => f.service === filter);

  const serviceCounts = SERVICES.reduce(
    (acc, s) => {
      acc[s] = allFiles.filter((f) => f.service === s).length;
      return acc;
    },
    {} as Record<LogService, number>,
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      const service = filter !== 'all' ? filter : undefined;
      await exportLogs({ service });
      toast.success('Logs exported successfully');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to export logs',
      );
    } finally {
      setExporting(false);
    }
  };

  const handleDownload = async (filename: string) => {
    setDownloading(filename);
    try {
      await downloadLogFile(filename);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to download file',
      );
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            Container Logs
          </h2>
          <p className="text-sm text-muted mt-1">
            Browse and export persistent log files. Logs are rotated daily with
            60-day retention.
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || allFiles.length === 0}
          className="px-4 py-2 text-sm font-medium bg-accent/20 text-accent border border-accent/40 rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {exporting ? 'Exporting...' : 'Export .tar.gz'}
        </button>
      </div>

      {/* Filter pills */}
      {allFiles.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
              filter === 'all'
                ? 'bg-accent/20 text-accent border-accent/40'
                : 'bg-surface/50 text-muted border-edge hover:text-foreground'
            }`}
          >
            All ({allFiles.length})
          </button>
          {SERVICES.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(filter === s ? 'all' : s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                filter === s
                  ? SERVICE_BADGE[s]
                  : 'bg-surface/50 text-muted border-edge hover:text-foreground'
              }`}
            >
              {s} ({serviceCounts[s]})
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {logs.isLoading && (
        <div className="py-12 text-center text-muted text-sm">
          Loading logs...
        </div>
      )}

      {/* Error */}
      {logs.isError && (
        <div className="py-12 text-center text-red-400 text-sm">
          Failed to load logs. Please try again.
        </div>
      )}

      {/* Empty */}
      {logs.data && allFiles.length === 0 && (
        <div className="py-12 text-center text-muted text-sm">
          No log files found. Logs are written when the container is running in
          production mode.
        </div>
      )}

      {/* Table */}
      {filtered.length > 0 && (
        <div className="border border-edge rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge bg-surface/50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">
                  Service
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">
                  Filename
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider hidden sm:table-cell">
                  Last Modified
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider hidden md:table-cell">
                  Size
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {filtered.map((file) => (
                <tr
                  key={file.filename}
                  className="hover:bg-surface/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full border ${SERVICE_BADGE[file.service]}`}
                    >
                      {file.service}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground truncate max-w-[200px]">
                    {file.filename}
                    <span className="sm:hidden block text-muted font-sans mt-0.5">
                      {formatDate(file.lastModified, tz)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted hidden sm:table-cell">
                    {formatDate(file.lastModified, tz)}
                  </td>
                  <td className="px-4 py-3 text-muted hidden md:table-cell">
                    {formatSize(file.sizeBytes)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDownload(file.filename)}
                      disabled={downloading === file.filename}
                      className="px-3 py-1 text-xs font-medium text-accent bg-accent/10 border border-accent/30 rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
                    >
                      {downloading === file.filename
                        ? 'Downloading...'
                        : 'Download'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty filter state */}
      {allFiles.length > 0 && filtered.length === 0 && (
        <div className="py-12 text-center text-muted text-sm">
          No logs match the selected filter.
        </div>
      )}
    </div>
  );
}
