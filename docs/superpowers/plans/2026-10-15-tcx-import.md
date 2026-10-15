# TCX Import Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task in this session. Preserve the current checkout and its existing uncommitted theme work. Do not commit, push, or migrate the development database.

**Goal:** Import the confirmed Mi Fitness TCX with explicit local-time correction, device metrics, private route storage, and consistent statistics.

**Architecture:** Parse TCX into existing point/segment structures plus device summaries. Extend the existing import orchestration with an explicit format parameter, sharing identity revalidation, locking, geodesic calculations, and atomic inserts; keep original files in format-specific source tables. Statistics prefer device timer when available.

**Tech Stack:** FastAPI, defusedxml, SQLAlchemy, Alembic/PostGIS, SvelteKit, pytest, Vitest, Chrome Playwright.

## Global Constraints

- One file, 10 MiB, 50,000 source points, 1,000 segments, isolated parse deadline 15 seconds.
- Default time interpretation respects offsets; explicit local mode repairs mislabeled exports using selected IANA timezone. Reject ambiguous/nonexistent local times.
- Supplied sample remains outside the repository; synthetic fixtures only.
- Keep elapsed_seconds as wall time and timer_seconds as device time. Keep new health metrics private.
- Only explicitly guarded isolated test databases may receive migrations or synthetic writes.

### Task 1: TCX parser and isolated execution

Files: backend/app/modules/tcx/{__init__,schema,parser}.py; backend/app/modules/gpx/worker.py; backend/tests/unit/test_tcx_parser.py.
Interfaces: parse_tcx(raw, timezone='UTC', time_mode='absolute') returns ParsedTCX (ParsedGPX subclass with summary dict). bounded_parse gains format/timezone/time_mode keyword arguments while preserving existing defaults and test targets.

- [x] Write synthetic TCX fixture factory and tests for summary extraction, local versus absolute instants, standard heart-rate values, weighted multi-Lap summary, rejected invalid fields, unsupported activities, unsafe XML, point/segment limits and DST cases.
- [x] Run `.venv/bin/pytest -q tests/unit/test_tcx_parser.py` and confirm missing implementation fails.
- [x] Implement namespace-aware bounded field extraction, strict numeric ranges, complete-only Lap aggregation, and explicit timestamp interpretation; dispatch parser in existing child process.
- [x] Run parser and existing GPX algorithm tests.

### Task 2: Persistence, import endpoint and aggregation

Files: backend/app/modules/tcx/{model,router}.py; backend/migrations/versions/0007_tcx_imports.py; backend/app/modules/{activities/{model,schema},gpx/{service,router,body_limit},statistics/service}.py; backend/app/{main,models/__init__}.py; backend/tests/integration/test_tcx_import.py; existing integration revision guards.
Interfaces: import_track(..., format='gpx', time_mode='absolute') preserves import_gpx wrapper and calls shared storage. TCX endpoint accepts file/title/timezone/activity_date/time_mode. ActivityView adds timer_seconds/calories_kcal/avg_heart_rate_bpm/steps with nullable defaults.

- [x] Write endpoint tests for corrected date, preserved bytes, device versus wall duration, statistics, privacy/CSRF, duplicates across modes/formats, failure atomicity and owner isolation; observe missing endpoint failure.
- [x] Add nullable metric columns and constrained source model/migration; register route/model; expand body limits; share orchestration with GPX.
- [x] In statistics use `func.coalesce(A.timer_seconds, A.elapsed_seconds)` for duration sums and pace eligibility, preserving existing summaries consumed by AI.
- [x] Read-only verify an isolated `_test` target, migrate only that target, run integration and existing GPX/statistics/sharing tests; check upgrade/downgrade on isolated schema.

### Task 3: Upload UI, activity display and acceptance

Files: frontend/src/lib/api/activities.ts; frontend/src/lib/server/proxy-policy.ts; frontend/src/routes/activities/{+page.svelte,[id]/+page.svelte}; frontend/src/lib/components/ActivityCard.svelte; related duration displays; frontend/tests/unit/{activities,proxy-policy}.test.ts; frontend/tests/ui/tcx.spec.ts; standalone TCX UI test configuration; docs/30-tcx-import.md.
Interfaces: uploadTcx(form, fetcher) shares CSRF uploader; Activity nullable optional device fields; activityDuration returns timer_seconds ?? elapsed_seconds. Upload entry accepts GPX/TCX with explicit format selector and TCX time interpretation selector.

- [x] Add failing unit/browser assertions for TCX endpoint, response metrics, upload body/timeout limits, selection of local-time mode, retry retaining input, corrected record details and mobile overflow.
- [x] Implement unified entry and private metric display with device time and wall time shown separately; route TCX through existing same-origin proxy protections.
- [x] Run frontend unit tests, `pnpm check`, `pnpm build`, and real Chrome desktop/mobile tests with synthetic API responses.
- [x] Run backend regression and lint, inspect final diff/dirty-state preservation, analyze actual supplied sample locally without saving private data, document pass versus runtime enablement boundary.

## Verification record (2026-10-15)

- Full backend suite: 374 passed, 1 skipped (snapshot test database not configured).
- Final GPX boundary regression was reproduced with a failing integration test, then fixed; final GPX/TCX/statistics/sharing regression: 73 passed.
- Ruff lint and formatting passed after the final test formatting correction.
- Frontend: 57 unit tests; svelte-check 0 errors/0 warnings; production build passed.
- Chrome fixture UI: 12 passed, including desktop/mobile, keyboard, retry and daily drawer. Real backend/browser E2E: 1 passed, covering authenticated upload, reload, statistics and CSRF.
- Isolated migration: 0006 -> 0007 -> 0006 -> 0007 passed; Alembic metadata check clean; refusal to downgrade populated TCX data verified.
- Real supplied file parsed locally with read-only PostGIS metrics only; never imported or copied into repository.
- Subsequently authorized by the user on 2026-10-15: development running_note migrated from 0006_running_goals to 0007_tcx_imports; existing table row counts preserved. Backend started on 8001, readiness returned database connected/PostGIS enabled/schema current; TCX endpoint rejects anonymous POST with 401 AUTH_REQUIRED. No real TCX imported.
