import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { SlowQueriesCard } from './slow-queries-card';

const API_BASE = 'http://localhost:3000';

vi.mock('../../hooks/use-auth', () => ({
  getAuthToken: vi.fn(() => 'test-token'),
}));

const SAMPLE_SNAPSHOT = {
  id: 1,
  capturedAt: '2026-04-28T12:00:00.000Z',
  source: 'cron' as const,
};

const SAMPLE_BASELINE = {
  id: 0,
  capturedAt: '2026-04-27T06:00:00.000Z',
  source: 'cron' as const,
};

function makeEntry(i: number) {
  return {
    queryid: String(1000 + i),
    queryText: `SELECT * FROM tbl_${i} WHERE id = $1`,
    calls: 10 + i,
    meanExecTimeMs: 250 + i,
    totalExecTimeMs: (250 + i) * (10 + i),
  };
}

function setupDigestHandler(
  payload:
    | { snapshot: typeof SAMPLE_SNAPSHOT; baseline: typeof SAMPLE_BASELINE | null; entries: ReturnType<typeof makeEntry>[] }
    | { snapshot: null; baseline: null; entries: [] },
) {
  server.use(
    http.get(`${API_BASE}/admin/slow-queries/digest`, () => HttpResponse.json(payload)),
  );
}

describe('SlowQueriesCard — loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Loading indicator while query is pending', () => {
    server.use(
      http.get(`${API_BASE}/admin/slow-queries/digest`, async () => {
        await new Promise(() => {});
        return HttpResponse.json({ snapshot: null, baseline: null, entries: [] });
      }),
    );

    renderWithProviders(<SlowQueriesCard />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});

describe('SlowQueriesCard — error state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders error message when the digest query errors', async () => {
    server.use(
      http.get(`${API_BASE}/admin/slow-queries/digest`, () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );

    renderWithProviders(<SlowQueriesCard />);
    expect(await screen.findByText(/failed to load slow queries/i)).toBeInTheDocument();
  });
});

describe('SlowQueriesCard — empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDigestHandler({ snapshot: null, baseline: null, entries: [] });
  });

  it('renders empty-state message when API returns null snapshot', async () => {
    renderWithProviders(<SlowQueriesCard />);
    expect(
      await screen.findByText(/no baseline yet/i),
    ).toBeInTheDocument();
  });

  it('keeps the Refresh now button visible in empty state', async () => {
    renderWithProviders(<SlowQueriesCard />);
    await screen.findByText(/no baseline yet/i);
    expect(
      screen.getByRole('button', { name: /refresh now/i }),
    ).toBeInTheDocument();
  });
});

describe('SlowQueriesCard — populated state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDigestHandler({
      snapshot: SAMPLE_SNAPSHOT,
      baseline: SAMPLE_BASELINE,
      entries: Array.from({ length: 10 }, (_, i) => makeEntry(i)),
    });
  });

  it('renders top-10 rows with all four columns visible per row', async () => {
    renderWithProviders(<SlowQueriesCard />);

    const table = await screen.findByRole('table');
    expect(within(table).getByText(/query/i)).toBeInTheDocument();
    expect(within(table).getByText(/^calls$/i)).toBeInTheDocument();
    expect(within(table).getByText(/^mean/i)).toBeInTheDocument();
    expect(within(table).getByText(/^total/i)).toBeInTheDocument();

    const dataRows = within(table).getAllByRole('row').slice(1);
    expect(dataRows).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      const row = dataRows[i];
      const cells = within(row).getAllByRole('cell');
      expect(cells).toHaveLength(4);
      expect(cells[0]).toHaveTextContent(`tbl_${i}`);
      expect(cells[1]).toHaveTextContent(String(10 + i));
    }
  });
});

describe('SlowQueriesCard — refresh interaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clicking Refresh now triggers the snapshot mutation and re-renders with new data', async () => {
    const user = userEvent.setup();
    let getCalls = 0;
    server.use(
      http.get(`${API_BASE}/admin/slow-queries/digest`, () => {
        getCalls += 1;
        if (getCalls === 1) {
          return HttpResponse.json({ snapshot: null, baseline: null, entries: [] });
        }
        return HttpResponse.json({
          snapshot: SAMPLE_SNAPSHOT,
          baseline: SAMPLE_BASELINE,
          entries: [makeEntry(0)],
        });
      }),
      http.post(`${API_BASE}/admin/slow-queries/snapshot`, () =>
        HttpResponse.json({
          snapshot: SAMPLE_SNAPSHOT,
          baseline: SAMPLE_BASELINE,
          entries: [makeEntry(0)],
        }),
      ),
    );

    renderWithProviders(<SlowQueriesCard />);
    await screen.findByText(/no baseline yet/i);

    await user.click(screen.getByRole('button', { name: /refresh now/i }));

    expect(await screen.findByText(/tbl_0/i)).toBeInTheDocument();
  });

  it('disables the Refresh now button while the mutation is pending', async () => {
    const user = userEvent.setup();
    setupDigestHandler({ snapshot: null, baseline: null, entries: [] });

    let resolveSnapshot!: () => void;
    server.use(
      http.post(`${API_BASE}/admin/slow-queries/snapshot`, async () => {
        await new Promise<void>((resolve) => {
          resolveSnapshot = resolve;
        });
        return HttpResponse.json({
          snapshot: SAMPLE_SNAPSHOT,
          baseline: SAMPLE_BASELINE,
          entries: [],
        });
      }),
    );

    renderWithProviders(<SlowQueriesCard />);
    await screen.findByText(/no baseline yet/i);

    const button = screen.getByRole('button', { name: /refresh now/i });
    await user.click(button);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /refresh/i }),
      ).toBeDisabled();
    });

    resolveSnapshot();
  });
});

describe('SlowQueriesCard — accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDigestHandler({
      snapshot: SAMPLE_SNAPSHOT,
      baseline: SAMPLE_BASELINE,
      entries: [makeEntry(0)],
    });
  });

  it('Refresh now button has a discernible accessible name', async () => {
    renderWithProviders(<SlowQueriesCard />);
    const button = await screen.findByRole('button', { name: /refresh now/i });
    expect(button).toHaveAccessibleName();
  });

  it('table has a caption describing it', async () => {
    renderWithProviders(<SlowQueriesCard />);
    const table = await screen.findByRole('table');
    const caption = within(table).getByText(/slow queries/i, { selector: 'caption' });
    expect(caption).toBeInTheDocument();
  });
});
