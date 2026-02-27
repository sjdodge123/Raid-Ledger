# Testing Guide

Testing patterns, anti-patterns, and conventions for Raid Ledger.

## Philosophy

- **Assert on outputs and effects, not implementation details.** Tests should verify what the code *does*, not how it does it internally.
- **Prefer failing tests over false confidence.** A test that always passes is worse than no test — it hides regressions.
- **Test at the right level.** Pure functions get unit tests. Services get integration-style tests with mocked dependencies. Components get behavioral tests via Testing Library.

## Running Tests

```bash
# Backend (unit)
npm run test -w api                    # Run all
npm run test:cov -w api                # With coverage enforcement

# Backend (integration — requires Docker)
npm run test:integration -w api        # Uses Testcontainers (auto-manages PostgreSQL)

# Frontend
npm run test -w web                    # Run all
cd web && npx vitest run --coverage    # With coverage enforcement

# Smoke tests (Playwright)
npx playwright test                    # Auto-starts dev server
```

## Coverage Thresholds

Coverage is enforced in CI. Thresholds are set conservatively as a regression floor — they prevent coverage from *dropping*, not mandate a target.

| Metric     | Backend | Frontend |
|------------|---------|----------|
| Statements | 45%     | 34%      |
| Branches   | 40%     | 33%      |
| Functions  | 38%     | 27%      |
| Lines      | 45%     | 35%      |

Config locations: `api/jest.config.js` (coverageThreshold) and `web/vitest.config.ts` (coverage.thresholds).

## Backend Patterns

### Test module setup

Use NestJS `Test.createTestingModule()` with mocked providers:

```ts
const module = await Test.createTestingModule({
    providers: [
        MyService,
        { provide: 'DB', useValue: createDrizzleMock() },
        { provide: OtherService, useValue: { doThing: jest.fn() } },
    ],
}).compile();

service = module.get(MyService);
mockDb = module.get('DB');
```

### Drizzle mock

Import the shared flat mock from `api/src/common/testing/drizzle-mock.ts`:

```ts
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';

const mockDb = createDrizzleMock();

// Control return values via terminal methods:
mockDb.returning.mockResolvedValueOnce([{ id: 1, name: 'Test' }]);
mockDb.limit.mockResolvedValueOnce([{ id: 1 }]);

// For transactions:
mockDb.transaction.mockImplementation(async (fn) => fn(mockDb));
```

**When NOT to use the flat mock:** Queries that terminate at `.where()`, `.from()`, or `.orderBy()` need deep mocks because these methods return `this` (not a thenable). See `characters.service.spec.ts` or `availability.service.spec.ts` for examples.

### Test factories

Use shared factories from `api/src/common/testing/factories.ts`:

```ts
import { createMockUser, createMockEvent } from '../common/testing/factories';

const user = createMockUser({ role: 'admin' });
const event = createMockEvent({ title: 'Raid Night', creatorId: user.id });
```

### Shape assertions

Assert on the *shape* of results, not exact mock values:

```ts
// Good — verifies the service transforms data correctly
expect(result).toMatchObject({
    id: expect.any(Number),
    title: expect.any(String),
    startTime: expect.any(Date),
});

// Bad — circular: mock returns X, test asserts X
expect(result.id).toBe(mockEvent.id);
```

## Frontend Patterns

### Query selection priority

Prefer queries that reflect how users interact with the page:

1. `getByRole('button', { name: /submit/i })` — best
2. `getByLabelText('Email')` — form fields
3. `getByText('Submit')` — visible text
4. `getByTestId('submit-btn')` — last resort

### User interactions

Use `@testing-library/user-event` over `fireEvent`:

```ts
import userEvent from '@testing-library/user-event';

it('submits the form', async () => {
    const user = userEvent.setup();
    render(<MyForm />);
    await user.type(screen.getByLabelText('Name'), 'Test');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(screen.getByText('Saved')).toBeInTheDocument();
});
```

### Accessibility testing

Use `vitest-axe` to catch a11y violations:

```ts
import { axe } from 'vitest-axe';

it('has no accessibility violations', async () => {
    const { container } = render(<MyComponent />);
    expect(await axe(container)).toHaveNoViolations();
});
```

Add a11y checks to interactive components: modals, dropdowns, forms, navigation.

### API mocking with MSW

MSW handlers live in `web/src/test/mocks/handlers.ts`. The server starts automatically via `setup.ts`.

Override handlers in specific tests:

```ts
import { server } from '../../test/mocks/server';
import { http, HttpResponse } from 'msw';

it('shows error state', async () => {
    server.use(
        http.get('http://localhost:3000/events', () =>
            HttpResponse.json({ error: 'fail' }, { status: 500 }),
        ),
    );
    render(<EventsList />);
    expect(await screen.findByText(/error/i)).toBeInTheDocument();
});
```

### Test factories (frontend)

Use shared factories from `web/src/test/factories.ts`:

```ts
import { createMockEvent, createMockUser } from '../../test/factories';

const event = createMockEvent({ title: 'Game Night' });
```

### Render helpers

Use `renderWithProviders()` from `web/src/test/render-helpers.tsx` to wrap components in QueryClient + Router:

```ts
import { renderWithProviders } from '../../test/render-helpers';

renderWithProviders(<MyPage />);
```

## Integration Tests (Backend)

Integration tests run against a real PostgreSQL database using [Testcontainers](https://node.testcontainers.org/). They catch bugs that unit tests with `drizzle-mock` cannot — like persistence failures, missing JOINs, and FK constraint issues.

**Requires:** Docker running locally. Testcontainers auto-starts and auto-stops a PostgreSQL container.

### When to write integration tests

- CRUD flows where data must persist correctly (settings, events, channel bindings)
- Queries involving JOINs across tables (e.g., channel binding + game name)
- Auth flows (login → token → protected endpoint)
- Any bug found in production that passed unit tests

### Test infrastructure

| File | Purpose |
|------|---------|
| `api/src/common/testing/test-app.ts` | Singleton TestApp: starts container, runs migrations, boots NestJS |
| `api/src/common/testing/integration-helpers.ts` | DB seeding, truncation, login helper |
| `api/jest.integration.config.js` | Jest config targeting `*.integration.spec.ts` |

### Writing an integration test

```ts
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables, loginAsAdmin } from '../common/testing/integration-helpers';

describe('My Feature (integration)', () => {
    let testApp: TestApp;
    let adminToken: string;

    beforeAll(async () => {
        testApp = await getTestApp();
        adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    });

    afterEach(async () => {
        // Clean slate between tests — re-seeds baseline data
        testApp.seed = await truncateAllTables(testApp.db);
        adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    });

    it('should persist and retrieve data', async () => {
        const res = await testApp.request
            .post('/my-endpoint')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ key: 'value' });

        expect(res.status).toBe(200);
    });
});
```

### Key details

- **Singleton pattern:** `getTestApp()` boots the container and app once per test run (not per file). All suites share the same instance for performance.
- **DB isolation:** `truncateAllTables()` clears all tables and re-seeds baseline data between tests.
- **Baseline seed data:** An admin user with local credentials and a sample game. Access via `testApp.seed`.
- **File naming:** `*.integration.spec.ts` — picked up by `jest.integration.config.js`, excluded from unit test runs.
- **Timeout:** 120s per test (container startup takes ~10-20s on first run).
- **Teardown:** `closeTestApp()` runs automatically via a global `afterAll` hook registered in `setupFilesAfterEnv`. Do not call it manually in your test files.

### HTTP endpoints vs direct DB operations

Prefer **HTTP endpoints** (`testApp.request.get/post/put/delete`) for tests that verify the full request-response cycle — auth, validation, serialization, and persistence through the real controller+service stack.

Use **direct DB operations** (`testApp.db.insert/select/delete`) only when the controller is not directly testable (e.g., Discord bot endpoints that require a live bot connection) or when verifying DB-level behavior like FK cascades, unique constraints, and JOINs.

## Anti-Patterns to Avoid

### 1. "Should be defined" boilerplate

```ts
// Bad — tests that NestJS DI works, not your code
it('should be defined', () => {
    expect(service).toBeDefined();
});
// Fix: delete the test entirely
```

### 2. Circular mock assertions

```ts
// Bad — mock returns mockUser, test asserts mockUser
mockDb.returning.mockResolvedValue([mockUser]);
const result = await service.create(dto);
expect(result.id).toBe(mockUser.id);

// Good — assert on shape/transformation
expect(result).toMatchObject({
    id: expect.any(Number),
    username: expect.any(String),
});
```

### 3. CSS/Tailwind class assertions

```ts
// Bad — breaks when Tailwind classes change
expect(button).toHaveClass('bg-emerald-600');
expect(container).toHaveClass('md:hidden');

// Good — test behavior or visibility
expect(button).toBeEnabled();
expect(container).not.toBeVisible();
```

### 4. Deep Drizzle chain mocks mirroring query builder

```ts
// Bad — couples test to exact query shape
const mockSelect = jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockResolvedValue([...]),
        }),
    }),
});

// Good — use flat mock, control via terminal
const mockDb = createDrizzleMock();
mockDb.limit.mockResolvedValueOnce([{ id: 1 }]);
```

### 5. Mock-only assertions (no output check)

```ts
// Bad — only verifies the call was made, not the result
await service.create(dto);
expect(mockDb.insert).toHaveBeenCalledWith(usersTable);

// Good — assert on output first, mock call second
const result = await service.create(dto);
expect(result).toMatchObject({ id: expect.any(Number) });
expect(mockDb.insert).toHaveBeenCalledWith(usersTable);
```

### 6. Testing localStorage directly

```ts
// Bad — tests storage mechanism, not behavior
expect(localStorage.getItem('theme')).toBe('dark');

// Good — test the store state or rendered UI
expect(useThemeStore.getState().theme).toBe('dark');
```

### 7. `vi.doMock()` re-mock fragility

```ts
// Bad — dynamic re-mocking is fragile and hard to debug
vi.doMock('./config', () => ({ featureFlag: true }));
const { MyComponent } = await import('./MyComponent');

// Good — pass config via props or context
render(<MyComponent featureEnabled={true} />);
```

## Smoke Tests (Playwright)

Smoke tests live in `scripts/verify-ui.spec.ts` and run in CI via the `smoke-tests` job with `DEMO_MODE=true`.

### Adding a new smoke test

1. Add the test to the appropriate `test.describe` block in `scripts/verify-ui.spec.ts`
2. Use demo-mode persona login when authentication is needed:
   ```ts
   await page.goto('/login');
   const adminBtn = page.getByRole('button', { name: /admin/i });
   await adminBtn.click();
   await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10_000 });
   ```
3. Keep tests resilient — use `isVisible().catch(() => false)` guards for optional UI elements
4. Test for absence of errors rather than exact content: `expect(page.locator('body')).not.toHaveText(/something went wrong/i)`

### Running locally

```bash
npx playwright test                           # auto-starts dev server on :5173
BASE_URL=http://localhost:80 npx playwright test  # against Docker
```

## Exemplary Reference Files

These files demonstrate best testing practices — use them as templates:

### Backend
| File | Pattern |
|------|---------|
| `settings/encryption.util.spec.ts` | Pure function testing with real crypto, edge cases |
| `events/recurrence.util.spec.ts` | Pure functions, timezone/DST edge cases |
| `sentry/sentry-exception.filter.spec.ts` | HTTP/non-HTTP contexts, non-Error throwables |
| `discord-bot/discord-bot-client.service.spec.ts` | Real bot lifecycle, error recovery |
| `discord-bot/listeners/signup-interaction.listener.spec.ts` | Full signup flows, cooldowns |
| `settings/settings.integration.spec.ts` | **Integration test exemplar** — real DB CRUD, encrypted settings persistence |

### Frontend
| File | Pattern |
|------|---------|
| `components/common/UserLink.test.tsx` | Propagation, avatar fallbacks, ARIA labels |
| `components/events/event-card.test.tsx` | Factory pattern, behavioral assertions, fake timers |
| `components/ui/modal.test.tsx` | Focus trap, ESC key, backdrop click, vitest-axe |
| `lib/avatar.test.ts` | Pure function, URL construction edge cases |
