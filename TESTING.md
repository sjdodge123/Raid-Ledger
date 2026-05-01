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

### Local startup timeout (macOS, parallel jest)

`provisionDatabase()` in `api/src/common/testing/test-app.ts` chains `.withStartupTimeout(60_000)` on the `pgvector/pgvector:pg16` testcontainer to absorb macOS Docker Desktop's vmnet port-binding latency under parallel jest workers. The library default of 10s is too tight when multiple suites spin containers simultaneously and was tripping `Timed out after 10000ms while waiting for container ports to be bound to the host` during `./scripts/validate-ci.sh --full`.

CI is unaffected: GitHub Actions sets `DATABASE_URL` to a Postgres service container, which short-circuits `provisionDatabase()` before testcontainers is touched. The 60s timeout only governs the local fallback path.

### HTTP endpoints vs direct DB operations

Prefer **HTTP endpoints** (`testApp.request.get/post/put/delete`) for tests that verify the full request-response cycle — auth, validation, serialization, and persistence through the real controller+service stack.

Use **direct DB operations** (`testApp.db.insert/select/delete`) only when the controller is not directly testable (e.g., Discord bot endpoints that require a live bot connection) or when verifying DB-level behavior like FK cascades, unique constraints, and JOINs.

## Test File Size Limits

Test files have a **750-line limit** (enforced by ESLint `max-lines` with `skipBlankLines + skipComments`). Functions within test files are still limited to **30 lines**.

### Splitting large test files

When a test file exceeds 750 lines, split by top-level `describe` block:

```
signups.service.spec.ts (2400 lines)
  → signups.service.signup.spec.ts
  → signups.service.cancel.spec.ts
  → signups.service.promotion-mmo.spec.ts
  → signups.service.roster.spec.ts
  → signups.spec-helpers.ts (shared setup)
```

**Naming convention:** `{original-name}.{concern}.spec.ts`

### Shared test setup

Extract common `beforeEach` setup, mock factories, and module creation into `{name}.spec-helpers.ts`:

```ts
// signups.spec-helpers.ts
export function createSignupsTestModule() {
    return Test.createTestingModule({
        providers: [SignupsService, ...mocks],
    }).compile();
}
```

Import in sibling spec files:
```ts
import { createSignupsTestModule } from './signups.spec-helpers';
```

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

Playwright smoke tests verify end-to-end UI flows in a real browser against a running dev server with demo data. They run in CI via the `smoke-tests` job with `DEMO_MODE=true`.

> **Per-spec fixture requirements** are documented in [`scripts/smoke/README.md`](scripts/smoke/README.md) — read before adding a new spec or debugging a "first-run-only" failure (ROK-1070).

### Directory structure

Tests are split per feature in `scripts/smoke/`:

```
scripts/
├── playwright-global-setup.ts        # Authenticates admin, seeds demo data, saves storageState
├── smoke/
│   ├── helpers.ts                    # Shared navigation + viewport helpers
│   ├── auth.smoke.spec.ts            # Login, credentials, unauthenticated guard
│   ├── calendar.smoke.spec.ts        # Calendar views
│   ├── characters.smoke.spec.ts      # Character management
│   ├── events.smoke.spec.ts          # Event list, detail, reschedule, regressions
│   ├── games.smoke.spec.ts           # Game library
│   ├── navigation.smoke.spec.ts      # Sidebar, routing, responsive nav
│   ├── notifications.smoke.spec.ts   # Notification center
│   └── players.smoke.spec.ts         # Player profiles
```

**File naming convention:** `<feature>.smoke.spec.ts` — Playwright picks up files matching `*.smoke.spec.ts` in `scripts/smoke/` (configured in `playwright.config.ts`).

### Playwright projects

Two viewport projects run every test file:

| Project | Device Profile | Purpose |
|---------|---------------|---------|
| `desktop` | `Desktop Chrome` | Standard desktop viewport |
| `mobile` | `Pixel 5` | Mobile responsive layout testing |

Tests that only apply to one viewport should skip the other:

```ts
test('desktop grid renders event cards', async ({ page }) => {
    test.skip(test.info().project.name === 'mobile', 'Desktop-only test — uses desktop grid selectors');
    // ...
});
```

### Authentication

Global setup (`scripts/playwright-global-setup.ts`) runs before all tests:

1. Authenticates `admin@local` via `POST /auth/local`
2. Seeds demo data via `POST /admin/settings/demo/install` (idempotent)
3. Saves `storageState` to `scripts/.auth/admin.json`

All tests inherit this authenticated state automatically. For tests that need an unauthenticated context:

```ts
test('redirects to login when unauthenticated', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    // ... test unauthenticated behavior ...
    await context.close();
});
```

### Writing a Playwright smoke test

1. Create a new file `scripts/smoke/<feature>.smoke.spec.ts` (or add to an existing file if the feature fits)
2. Import from `@playwright/test` and use shared helpers from `./helpers`
3. Keep tests resilient — use `isVisible().catch(() => false)` guards for optional UI elements
4. Test for absence of errors rather than exact content: `expect(page.locator('body')).not.toHaveText(/something went wrong/i)`
5. Use `test.skip()` with a descriptive reason for viewport-specific tests
6. Clean up resources in `finally` blocks when tests create data via API

### Running locally

```bash
npx playwright test                               # All tests — auto-starts dev server on :5173
npx playwright test --project=desktop              # Desktop viewport only
npx playwright test --project=mobile               # Mobile viewport only
npx playwright test scripts/smoke/events.smoke.spec.ts  # Single file
npx playwright test --ui                           # Interactive UI mode
BASE_URL=http://localhost:80 npx playwright test   # Against Docker
```

## Smoke Test Authoring Standards (Discord Companion Bot)

Discord smoke tests live in `tools/test-bot/src/smoke/tests/`. These rules ensure reliability and eliminate flaky timing issues.

### Rule 1: No `sleep()` calls

**Never** use `sleep()`, `setTimeout`, or fixed delays. Use deterministic wait helpers instead:

```ts
// BAD — flaky, wastes CI time
await sleep(2000);

// GOOD — drains all BullMQ queues before continuing
await awaitProcessing(ctx.api);

// GOOD — polls until a condition is met
await pollForCondition(
  async () => {
    const result = await ctx.api.get(`/some-endpoint`);
    return result.ready ? result : null;
  },
  ctx.config.timeoutMs,
  { intervalMs: 2000 },
);
```

### Rule 2: Every async side-effect needs a deterministic wait

After any action that triggers background processing (signups, cancellations, reschedules, roster changes), call `awaitProcessing(ctx.api)` before asserting on the result. This drains all BullMQ queues server-side.

### Rule 3: New wait helpers go in shared modules

- **API-triggered waits** (queue drains, DB flushes): `tools/test-bot/src/smoke/fixtures.ts`
- **Polling helpers** (channel messages, DMs, conditions): `tools/test-bot/src/helpers/polling.ts`

Available helpers:

| Helper | Location | Purpose |
|--------|----------|---------|
| `awaitProcessing(api)` | `fixtures.ts` | Drain all BullMQ queues |
| `flushVoiceSessions(api)` | `fixtures.ts` | Flush in-memory voice sessions to DB |
| `flushEmbedQueue(api)` | `fixtures.ts` | Drain embed sync queue |
| `flushNotificationBuffer(api)` | `fixtures.ts` | Flush buffered notifications |
| `pollForCondition(check, timeout)` | `polling.ts` | Generic condition poller with backoff |
| `pollForEmbed(channelId, predicate, timeout)` | `polling.ts` | Poll channel for matching message |
| `waitForEmbedUpdate(channelId, predicate, timeout)` | `polling.ts` | Event listener + poll fallback for edits |
| `waitForDM(userId, predicate, timeout)` | `polling.ts` | Poll DM channel for matching message |

### Rule 4: Timeouts are generous

- Default timeout: 10s for most operations
- Slow operations (reminders, cron-triggered): 30-60s
- Use `ctx.config.timeoutMs` for standard timeouts, override with a literal for known-slow paths

### Rule 5: Tests must be idempotent

- Create unique resources per test (use `createEvent(api, 'tag')` which generates UIDs)
- Clean up in `finally` blocks — delete events, bindings, and other test data
- Never depend on state from a previous test

### Rule 6: Lint before pushing

Run the no-sleep lint to catch accidental `sleep()` regressions:

```bash
cd tools/test-bot && npm run lint:no-sleep
```

This script (`tools/test-bot/scripts/no-sleep-lint.sh`) scans all smoke test files for `sleep()` calls and fails if any are found.

## Discord Smoke Tests (Companion Bot)

The Discord companion bot runs smoke tests (see `tools/test-bot/src/smoke/tests/*.test.ts`) that validate real Discord behavior end-to-end — embed posting, roster calculations, DM notifications, interaction flows, and voice activity. These extend the authoring standards above with operational details.

### Directory structure

```
tools/test-bot/src/smoke/
├── api.ts               # HTTP client for API calls
├── assert.ts            # Assertion helpers (assertEmbedTitle, assertHasButton, etc.)
├── config.ts            # Smoke config from env vars (API_URL, guild ID, timeouts)
├── fixtures.ts          # Test fixtures (createEvent, signup, awaitProcessing, etc.)
├── run.ts               # Test runner — connects bot, discovers channels, runs all suites
├── types.ts             # SmokeTest and TestContext type definitions
└── tests/
    ├── channel-embeds.test.ts      # Embed lifecycle: post, update, cancel, reschedule
    ├── roster-calculation.test.ts  # Slot allocation, MMO roles, bench promotion
    ├── dm-notifications.test.ts    # DM delivery for signups, reminders, roster changes
    ├── interaction-flows.test.ts   # Multi-step flows: signup→cancel, vacate→promote
    ├── voice-activity.test.ts      # Voice join/leave, attendance tracking, session flush
    └── push-content.test.ts        # Push notification content validation
```

### Test categories

| Category | File | Tests | What it validates |
|----------|------|-------|-------------------|
| Channel embeds | `channel-embeds.test.ts` | 8 | Embed posted, FILLING status, tentative, cancel signup, event cancel, reschedule, buttons, non-MMO avatar filtering |
| Roster calculation | `roster-calculation.test.ts` | 4 | Slot allocation, MMO role assignment, bench overflow, promotion |
| DM notifications | `dm-notifications.test.ts` | 18+1 slow | Signup confirmation, roster assignment, event cancellation, reminders |
| Interaction flows | `interaction-flows.test.ts` | 8 | Bot connectivity, signup→cancel, slot vacate, bench promote, embed sync, multi-user, event delete cleanup, duplicate signup character data |
| Voice activity | `voice-activity.test.ts` | 4+2 slow | Voice join/leave tracking, attendance session management |
| Push content | `push-content.test.ts` | 8 | Push notification payload validation |

### Test anatomy

Each smoke test implements the `SmokeTest` interface:

```ts
const myTest: SmokeTest = {
  name: 'Descriptive test name',
  category: 'embed',  // Used for reporting/filtering
  async run(ctx: TestContext) {
    const ev = await createEvent(ctx.api, 'unique-tag', { /* overrides */ });
    try {
      // Wait for embed to appear in Discord channel
      const msg = await pollForEmbed(
        ctx.defaultChannelId,
        (m) => m.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );
      // Assert on the embed content
      assertEmbedTitle(msg.embeds[0], /expected pattern/);
    } finally {
      await deleteEvent(ctx.api, ev.id);  // Always clean up
    }
  },
};
```

### Setup and running

1. Configure `tools/test-bot/.env` with bot token and guild ID
2. Ensure the API is running with `DEMO_MODE=true` and the Discord bot is connected
3. Run:

```bash
cd tools/test-bot && npm run smoke       # Full suite
cd tools/test-bot && npm run lint:no-sleep  # Verify no sleep() calls before pushing
```

### Files that trigger smoke test review

When any of these files change, Discord smoke tests should be run and reviewed. See `CLAUDE.md` for the quick-reference trigger file list.

- `api/src/discord-bot/**` — bot listeners, embed factory, channel bindings, voice state
- `api/src/notifications/**` — notification dispatch, DM embeds, reminder services
- `api/src/events/signups*` — signup creation, auto-allocation, roster assignment
- `api/src/events/event-lifecycle*` — cancel, reschedule, delete flows
- `tools/test-bot/src/smoke/**` — the smoke tests themselves

## TDD Workflow

Raid Ledger follows a test-driven development (TDD) workflow where the test agent writes failing tests first, and the dev agent builds code to make them pass. This ensures every feature ships with coverage and that specs are validated before implementation begins.

### When to write tests first

| Scenario | Write test first? | Rationale |
|----------|--------------------|-----------|
| New feature with clear AC | Yes | Spec is well-defined — translate AC into assertions |
| Bug fix with reproduction steps | Yes | Write a failing test that reproduces the bug, then fix it |
| Refactoring existing code | Yes (if missing) | Add coverage for current behavior before restructuring |
| Exploratory spike | No | Spike first, add tests when the approach solidifies |
| Docs-only / config changes | No | No runtime behavior to test |

### The TDD flow

1. **Test agent reads the spec** — acceptance criteria, architect guidance, and any linked issues
2. **Test agent writes failing tests** — one or more tests per AC, committed to the feature branch
3. **Dev agent pulls the failing tests** — builds the implementation to make them pass
4. **Dev agent runs all tests** — confirms the new tests pass and no existing tests regress
5. **Both verify** — the test agent may add edge-case tests after the initial implementation

### Test type mapping

Every feature or fix requires an end-to-end test. The type depends on what changed:

| Change type | Test type | Location | Example |
|-------------|-----------|----------|---------|
| UI feature / page | Playwright smoke test | `scripts/smoke/<feature>.smoke.spec.ts` | New page renders, form submits, responsive layout works |
| Discord bot / notification | Companion bot smoke test | `tools/test-bot/src/smoke/tests/` | Embed posts correctly, DM delivered, roster updates reflected |
| API endpoint / service | Integration test | `api/src/**/*.integration.spec.ts` | CRUD persists, JOINs work, auth enforced |
| Pure logic / utility | Unit test | `api/src/**/*.spec.ts` or `web/src/**/*.test.ts` | Function produces correct output for all edge cases |

### Writing a failing test from a spec

Start from the acceptance criteria and work backwards:

```ts
// AC: "Reschedule modal shows player availability count"
test('reschedule modal shows signup count', async ({ page }) => {
    await navigateToFirstEvent(page, testInfo);
    await page.getByRole('button', { name: 'Reschedule' }).click();
    // This assertion will FAIL until the feature is implemented
    await expect(page.getByText(/player availability/i)).toBeVisible({ timeout: 5_000 });
});
```

For backend features, write the integration test against the expected API contract:

```ts
// AC: "PATCH /events/:id/reschedule returns new start time"
it('returns updated start time after reschedule', async () => {
    const res = await testApp.request
        .patch(`/events/${eventId}/reschedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ startTime: newTime, endTime: newEndTime });
    expect(res.status).toBe(200);
    expect(new Date(res.body.startTime).getTime()).toBe(newTime.getTime());
});
```

## E2E Test Requirements

Every feature and bug fix must include an end-to-end test. This is not optional — untested code does not ship.

### What qualifies as an e2e test

| Change type | Required test | What it proves |
|-------------|--------------|----------------|
| UI changes | Playwright smoke test (both `desktop` and `mobile` projects) | Page renders, interactions work, responsive layout correct |
| Discord bot / notification changes | Companion bot smoke test | Real Discord messages sent, embeds correct, DMs delivered |
| API-only changes | Integration test (Jest, real DB via Testcontainers) | Full request→response cycle works with real persistence |
| Pure logic | Unit test | All edge cases covered, transformations correct |

### Coverage must be meaningful

A test that only checks "no crash" is insufficient. Tests must verify the **behavioral outcome** described in the acceptance criteria:

```ts
// Insufficient — only proves the page loads
await expect(page.locator('body')).not.toHaveText(/something went wrong/i);

// Sufficient — proves the feature works
await expect(page.getByRole('heading', { name: 'Reschedule Event' })).toBeVisible();
await expect(page.getByText(/player availability/i)).toBeVisible();
```

### When multiple test types apply

Some features span multiple layers. In those cases, write tests at each relevant level:

- A Discord embed feature needs both a **companion bot smoke test** (embed content) and a **unit test** (embed builder logic)
- A new API endpoint needs both an **integration test** (persistence + auth) and a **Playwright smoke test** if it has a UI

## Test Failure Rules

Test failures are treated as blocking issues. No exceptions.

### NEVER dismiss failures as "pre-existing"

Every test failure encountered during development must be investigated. If the failure is genuinely unrelated to the current change:

1. Identify the root cause
2. Fix it in the current PR if the fix is small
3. If the fix is non-trivial, create a Linear story with the root cause and a reproduction path — do NOT just skip the test

### NEVER skip or weaken assertions to make CI pass

```ts
// NEVER DO THIS — weakening an assertion to avoid a failure
test.skip('embed shows roster count');  // "Skipping flaky test"

// NEVER DO THIS — loosening the assertion
expect(rosterCount).toBeGreaterThanOrEqual(0);  // Was: expect(rosterCount).toBe(3)
```

If a test is failing, the correct response is one of:
- **Fix the code** — the test caught a real bug
- **Fix the test infrastructure** — a helper or mock is misconfigured
- **Update the test** — the behavior intentionally changed (document why in the commit message)

### Every failure gets investigated

When a test fails in CI or locally:

1. **Read the full error** — stack trace, assertion diff, screenshot (Playwright)
2. **Reproduce locally** — run the specific test in isolation
3. **Identify root cause** — is it a code bug, test bug, or environment issue?
4. **Fix or track** — fix in-PR or create a Linear story with root cause analysis

### No `sleep()` in smoke tests

This rule is critical for reliability. See the "Smoke Test Authoring Standards" section above for deterministic wait helpers. The `lint:no-sleep` script enforces this automatically.

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

### Playwright Smoke Tests
| File | Pattern |
|------|---------|
| `scripts/smoke/events.smoke.spec.ts` | Desktop/mobile viewport skipping, navigateToFirstEvent helper, API-driven test data with `finally` cleanup, regression test blocks |

### Discord Smoke Tests
| File | Pattern |
|------|---------|
| `tools/test-bot/src/smoke/tests/channel-embeds.test.ts` | SmokeTest interface, pollForEmbed + waitForEmbedUpdate, `finally` cleanup with deleteEvent, MMO-aware overrides, assertEmbedTitle/assertHasButton assertions |
