# Dashboard Activity Explorer Implementation Plan

**Goal:** Fit the full year calendar and browse category-filtered activity history with selected metrics and route on the dashboard.

**Architecture:** Reuse CalendarGrid, RouteMap and MetricSummary; add a focused ActivityExplorer component with request generation guards. Extend the authenticated list with optional exact category and add an owner-scoped categories GET. No migration.

**Tech Stack:** Svelte 5, TypeScript, FastAPI, SQLAlchemy, PostgreSQL, Vitest, Playwright Chrome.

## Constraints

Preserve dirty work, routes/auth/privacy and existing metrics semantics. No development service restart, development DB writes, migration, commit or push. Execute directly in the existing checkout because prior feature changes are required dependencies. Tests use synthetic fixtures and the existing isolated test PostgreSQL only.

### 1. Category reads

- [x] Add backend integration tests for GET categories, owner isolation, empty category, exact special-character matching, paging, anonymous denial and 30-character bound; observe failure.
- [x] Extend `service.listing(..., category=None)` and router category Query(max_length=30); add static `/categories` before UUID routes returning `list[str]` from distinct owner categories.
- [x] Add frontend API tests for encoded category filters and categories response rejection; observe failures. Extend `readActivities(fetcher,offset,date,category?)` and add `readActivityCategories(fetcher)`.
- [x] Run isolated integration tests and frontend unit tests to green.

### 2. Full year calendar

- [x] Update dashboard Chrome year flows to automatic input (no View button), add whole-year width/365-366 checks; observe failure.
- [x] Remove year submit button, validate four digits on input and update immediately; preserve invalid feedback, arrows, URL and request guards.
- [x] Give enhanced CalendarGrid full-width week columns on desktop and a single responsive 12-month grid on mobile. Render each date once, keep keyboard/day-selection behavior, and replace scroll hint.
- [x] Verify ordinary/leap years, latest year response, phone sizing and keyboard.

### 3. Activity explorer and wall navigation

- [x] Add Chrome tests for default latest metrics/route, category reset, historical pagination, earlier/newer navigation, selection, stale reads, missing routes/retry, expired identity, keyboard, mobile and navigation highlight; observe failures.
- [x] Create `ActivityExplorer.svelte`, use owner categories + list pagination; default select first item, generation-guard list/detail/route reads, clear old private state, independent retry. Keep browse selection and category filters separate from calendar year.
- [x] Replace dashboard wall preview with explorer. Add wall nav entry and suppress Activities active state on wall.
- [x] Update shared fixture and affected milestones expectations to use new selected-record interaction; keep independent wall checks.

### 4. Verification and documentation

- [x] Run `pnpm test`, `pnpm check`, full Chrome UI regression plus activity library regression; run production build after browser tests stop.
- [x] Inspect desktop and mobile dark screenshots. Record actual backend test and UI outcomes, limitations and no service restart; stop only test-owned temporary services.
- [x] Review scoped changes, `git diff --check`, preserve unrelated dirty files. Document usage and test evidence.
