# Claude Code Review Standards

You are reviewing a pull request for the Raid Ledger project — a monorepo with `api` (NestJS), `web` (React/Vite), and `packages/contract` (shared Zod schemas).

## Context Files

Read these before reviewing:

- `CLAUDE.md` — project conventions, dev environment, testing commands
- `project-context.md` — architecture, stack, critical implementation rules
- `TESTING.md` — testing patterns, anti-patterns, coverage thresholds

## Review Checklist

### Architecture & Conventions

- Follow all rules in `CLAUDE.md` and `project-context.md`
- Zod schemas are the single source of truth for validation
- All API DTOs and frontend types derive from `packages/contract` — no manual type duplication
- TypeScript strict mode — no `any`
- File naming: `kebab-case`; classes: `PascalCase`; variables: `camelCase`; DB columns: `snake_case`
- Build order: `packages/contract` must build before `api` or `web`

### Contract & Schema Consistency

- Changes to `packages/contract` must be reflected in both `api` and `web` consumers
- Zod schemas in contract must match Drizzle schema column types
- New API endpoints must have corresponding contract definitions
- Breaking changes to existing API endpoints must be flagged

### Testing

- Follow patterns in `TESTING.md`
- New features and bug fixes must include test coverage
- Backend: Jest unit tests adjacent to implementation files
- Frontend: Vitest behavioral tests using Testing Library
- UI changes should include or update Playwright smoke tests
- Assert on outputs and effects, not implementation details

### Security (OWASP Top 10)

- SQL injection: verify parameterized queries, no raw SQL with user input
- XSS: verify output encoding, no `dangerouslySetInnerHTML` with user data
- Authentication/authorization bypass: verify guards on new endpoints
- Insecure direct object references: verify ownership checks
- Security misconfiguration: verify no secrets in code, no overly permissive CORS
- Sensitive data exposure: verify no PII in logs, no secrets in responses
- Missing rate limiting on public endpoints

### Code Quality

- No over-engineering: changes should be minimal and focused
- No unnecessary abstractions for one-time operations
- Prefer editing existing files over creating new ones
- No unused imports, variables, or dead code introduced

## Review Output

### Blocking Issues (Request Changes)

Flag these as **request changes** — the PR should not merge until resolved:

- Security vulnerabilities
- Breaking changes to existing API endpoints without migration path
- Missing test coverage for new features or bug fixes
- Type safety violations (`any`, unchecked casts)
- Contract/schema inconsistencies between packages

### Non-Blocking Findings (GitHub Issues)

For non-blocking findings, **do not block the PR**. Instead, create a GitHub issue for each distinct finding so it can be triaged into the backlog:

- Tech debt observations (tag: `tech-debt`)
- Test coverage gaps in existing (unchanged) code (tag: `test-coverage`)
- Performance improvement opportunities (tag: `performance`)
- Pattern inconsistencies with project conventions (tag: `conventions`)
- Security hardening suggestions for existing code (tag: `security`)

When creating issues:

- Title format: `[reviewer] <concise description>`
- Body: include the file path, line numbers, description of the finding, and a link back to the PR
- Labels: `reviewer-finding` plus a category label (`tech-debt`, `security`, `test-coverage`, `performance`, `conventions`)
- Reference the PR number in the issue body

### Approve

If there are no blocking issues, approve the PR with a summary of what was reviewed.
