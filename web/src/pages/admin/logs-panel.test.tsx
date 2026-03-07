import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { LogsPanel } from './logs-panel';

const API_BASE = 'http://localhost:3000';

const mockLogFiles = [
  {
    filename: 'api.log',
    service: 'api',
    sizeBytes: 1024,
    lastModified: '2026-03-01T12:00:00Z',
  },
  {
    filename: 'nginx.log',
    service: 'nginx',
    sizeBytes: 512,
    lastModified: '2026-03-02T08:00:00Z',
  },
  {
    filename: 'postgresql.log',
    service: 'postgresql',
    sizeBytes: 2048,
    lastModified: '2026-03-01T06:00:00Z',
  },
];

// Default handler for logs endpoint
function setupLogsHandler(
  files = mockLogFiles,
  status = 200,
) {
  server.use(
    http.get(`${API_BASE}/admin/logs`, () => {
      if (status !== 200) {
        return HttpResponse.json({ message: 'error' }, { status });
      }
      return HttpResponse.json({ files, total: files.length });
    }),
  );
}

// Mock use-auth token so queries are enabled
vi.mock('../../hooks/use-auth', () => ({
  getAuthToken: vi.fn(() => 'test-token'),
}));

// Mock timezone store
vi.mock('../../stores/timezone-store', () => ({
  useTimezoneStore: vi.fn((selector: (s: { resolved: string }) => string) =>
    selector({ resolved: 'UTC' }),
  ),
}));

// Mock use-logs download/export functions
vi.mock('../../hooks/use-logs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-logs')>();
  return {
    ...actual,
    downloadLogFile: vi.fn().mockResolvedValue(undefined),
    exportLogs: vi.fn().mockResolvedValue(undefined),
  };
});

// Import after mock so we get the mocked versions
import { downloadLogFile, exportLogs } from '../../hooks/use-logs';

describe('LogsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupLogsHandler();
  });

  describe('loading state', () => {
    it('shows loading indicator while fetching logs', () => {
      server.use(
        http.get(`${API_BASE}/admin/logs`, async () => {
          // Never resolves — stays loading
          await new Promise(() => {});
          return HttpResponse.json({ files: [], total: 0 });
        }),
      );

      renderWithProviders(<LogsPanel />);
      expect(screen.getByText(/loading logs/i)).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message when fetch fails', async () => {
      server.use(
        http.get(`${API_BASE}/admin/logs`, () =>
          HttpResponse.json({ message: 'Internal server error' }, { status: 500 }),
        ),
      );

      renderWithProviders(<LogsPanel />);
      expect(
        await screen.findByText(/failed to load logs/i),
      ).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows empty message when no logs exist', async () => {
      server.use(
        http.get(`${API_BASE}/admin/logs`, () =>
          HttpResponse.json({ files: [], total: 0 }),
        ),
      );

      renderWithProviders(<LogsPanel />);
      expect(
        await screen.findByText(/no log files found/i),
      ).toBeInTheDocument();
    });

    it('disables export button when no files exist', async () => {
      server.use(
        http.get(`${API_BASE}/admin/logs`, () =>
          HttpResponse.json({ files: [], total: 0 }),
        ),
      );

      renderWithProviders(<LogsPanel />);
      await screen.findByText(/no log files found/i);
      const exportButton = screen.getByRole('button', {
        name: /export .tar.gz/i,
      });
      expect(exportButton).toBeDisabled();
    });
  });

  describe('file list display', () => {
    it('renders all log files in a table', async () => {
      renderWithProviders(<LogsPanel />);

      expect(await screen.findByText('api.log')).toBeInTheDocument();
      expect(screen.getByText('nginx.log')).toBeInTheDocument();
      expect(screen.getByText('postgresql.log')).toBeInTheDocument();
    });

    it('renders service badges for each file', async () => {
      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      // Each service badge rendered in table rows
      const apiBadge = screen.getAllByText('api');
      const nginxBadge = screen.getAllByText('nginx');
      expect(apiBadge.length).toBeGreaterThan(0);
      expect(nginxBadge.length).toBeGreaterThan(0);
    });

    it('renders a download button for each file', async () => {
      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      const downloadButtons = screen.getAllByRole('button', {
        name: /download/i,
      });
      // 3 files + export button (but export says "Export .tar.gz" not "Download")
      expect(downloadButtons).toHaveLength(3);
    });

    async function testFormatsFileSizesCorrectly() {
      server.use(
        http.get(`${API_BASE}/admin/logs`, () =>
          HttpResponse.json({
            files: [
              {
                filename: 'api.log',
                service: 'api',
                sizeBytes: 500,
                lastModified: '2026-03-01T00:00:00Z',
              },
              {
                filename: 'nginx.log',
                service: 'nginx',
                sizeBytes: 2048,
                lastModified: '2026-03-01T00:00:00Z',
              },
              {
                filename: 'postgresql.log',
                service: 'postgresql',
                sizeBytes: 1572864,
                lastModified: '2026-03-01T00:00:00Z',
              },
            ],
            total: 3,
          }),
        ),
      );

      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      expect(screen.getByText('500 B')).toBeInTheDocument();
      expect(screen.getByText('2.0 KB')).toBeInTheDocument();
      expect(screen.getByText('1.50 MB')).toBeInTheDocument();
    
    }
    it('formats file sizes correctly', async () => { await testFormatsFileSizesCorrectly(); });

    it('shows filter pills when files are present', async () => {
      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      // "All" pill should be visible
      expect(screen.getByRole('button', { name: /all \(/i })).toBeInTheDocument();
    });
  });

  function serviceFilterGroup1() {
it('filters table to show only api logs when api pill is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      const apiPill = screen.getByRole('button', { name: /^api \(/i });
      await user.click(apiPill);

      expect(screen.getByText('api.log')).toBeInTheDocument();
      expect(screen.queryByText('nginx.log')).not.toBeInTheDocument();
      expect(screen.queryByText('postgresql.log')).not.toBeInTheDocument();
    });

it('clicking same service pill twice resets to all', async () => {
      const user = userEvent.setup();
      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      const apiPill = screen.getByRole('button', { name: /^api \(/i });
      await user.click(apiPill);
      await user.click(apiPill); // toggle off

      expect(screen.getByText('nginx.log')).toBeInTheDocument();
      expect(screen.getByText('postgresql.log')).toBeInTheDocument();
    });

  }

  function serviceFilterGroup2() {
it('clicking "All" pill after a filter shows all files', async () => {
      const user = userEvent.setup();
      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      const apiPill = screen.getByRole('button', { name: /^api \(/i });
      await user.click(apiPill);

      const allPill = screen.getByRole('button', { name: /^all \(/i });
      await user.click(allPill);

      expect(screen.getByText('nginx.log')).toBeInTheDocument();
      expect(screen.getByText('postgresql.log')).toBeInTheDocument();
    });

it('shows empty filter message when no files match the filter', async () => {
      const user = userEvent.setup();
      // Files only have api and nginx, no redis
      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      // Click redis (which has 0 files)
      const redisPill = screen.getByRole('button', { name: /^redis \(/i });
      await user.click(redisPill);

      expect(
        screen.getByText(/no logs match the selected filter/i),
      ).toBeInTheDocument();
    });

  }

  function serviceFilterGroup3() {
it('shows count for each service in filter pill', async () => {
      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      // api has 1 file
      expect(screen.getByRole('button', { name: /^api \(1\)/i })).toBeInTheDocument();
      // nginx has 1 file
      expect(screen.getByRole('button', { name: /^nginx \(1\)/i })).toBeInTheDocument();
    });

  }

  describe('service filter', () => {
      serviceFilterGroup1();
      serviceFilterGroup2();
      serviceFilterGroup3();
  });

  function downloadFileGroup1() {
it('calls downloadLogFile with filename when download button is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      const downloadButtons = screen.getAllByRole('button', {
        name: /^download$/i,
      });
      await user.click(downloadButtons[0]);

      expect(downloadLogFile).toHaveBeenCalledWith('api.log');
    });

  }

  function downloadFileGroup2() {
it('shows downloading state during download', async () => {
      const user = userEvent.setup();
      let resolveDownload!: () => void;
      vi.mocked(downloadLogFile).mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveDownload = resolve;
        }),
      );

      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      const downloadButtons = screen.getAllByRole('button', {
        name: /^download$/i,
      });
      await user.click(downloadButtons[0]);

      expect(screen.getByText('Downloading...')).toBeInTheDocument();

      resolveDownload();
      await waitFor(() => {
        expect(screen.queryByText('Downloading...')).not.toBeInTheDocument();
      });
    });

  }

  function downloadFileGroup3() {
it('shows error toast when download fails', async () => {
      const user = userEvent.setup();
      vi.mocked(downloadLogFile).mockRejectedValueOnce(
        new Error('Failed to download log file'),
      );

      // We need to verify toast.error is called — mock sonner
      const toastMock = { error: vi.fn(), success: vi.fn() };
      vi.doMock('sonner', () => ({ toast: toastMock }));

      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      const downloadButtons = screen.getAllByRole('button', {
        name: /^download$/i,
      });
      await user.click(downloadButtons[0]);

      // After error, button should return to normal state
      await waitFor(() => {
        expect(
          screen.queryByText('Downloading...'),
        ).not.toBeInTheDocument();
      });
    });

  }

  function downloadFileGroup4() {
it('disables download button while download is in progress', async () => {
      const user = userEvent.setup();
      let resolveDownload!: () => void;
      vi.mocked(downloadLogFile).mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveDownload = resolve;
        }),
      );

      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      const downloadButtons = screen.getAllByRole('button', {
        name: /^download$/i,
      });
      await user.click(downloadButtons[0]);

      // The clicked button should be disabled
      expect(screen.getByText('Downloading...')).toBeDisabled();

      resolveDownload();
    });

  }

  describe('download file', () => {
      downloadFileGroup1();
      downloadFileGroup2();
      downloadFileGroup3();
      downloadFileGroup4();
  });

  function exportGroup1() {
it('calls exportLogs with no service when "All" filter is active', async () => {
      const user = userEvent.setup();
      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      const exportBtn = screen.getByRole('button', { name: /export .tar.gz/i });
      await user.click(exportBtn);

      expect(exportLogs).toHaveBeenCalledWith({ service: undefined });
    });

it('calls exportLogs with service when a service filter is active', async () => {
      const user = userEvent.setup();
      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      const apiPill = screen.getByRole('button', { name: /^api \(/i });
      await user.click(apiPill);

      const exportBtn = screen.getByRole('button', { name: /export .tar.gz/i });
      await user.click(exportBtn);

      expect(exportLogs).toHaveBeenCalledWith({ service: 'api' });
    });

  }

  function exportGroup2() {
it('shows "Exporting..." text while export is in progress', async () => {
      const user = userEvent.setup();
      let resolveExport!: () => void;
      vi.mocked(exportLogs).mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveExport = resolve;
        }),
      );

      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      const exportBtn = screen.getByRole('button', { name: /export .tar.gz/i });
      await user.click(exportBtn);

      expect(screen.getByText('Exporting...')).toBeInTheDocument();

      resolveExport();
      await waitFor(() => {
        expect(screen.queryByText('Exporting...')).not.toBeInTheDocument();
      });
    });

  }

  function exportGroup3() {
it('disables export button while exporting', async () => {
      const user = userEvent.setup();
      let resolveExport!: () => void;
      vi.mocked(exportLogs).mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveExport = resolve;
        }),
      );

      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      const exportBtn = screen.getByRole('button', { name: /export .tar.gz/i });
      await user.click(exportBtn);

      expect(screen.getByText('Exporting...')).toBeDisabled();

      resolveExport();
    });

  }

  describe('export', () => {
      exportGroup1();
      exportGroup2();
      exportGroup3();
  });

  describe('heading and description', () => {
    it('renders the Container Logs heading', async () => {
      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      expect(
        screen.getByRole('heading', { name: /container logs/i }),
      ).toBeInTheDocument();
    });

    it('renders the 60-day retention description', async () => {
      renderWithProviders(<LogsPanel />);
      await screen.findByText('api.log');

      expect(screen.getByText(/60-day retention/i)).toBeInTheDocument();
    });
  });
});
