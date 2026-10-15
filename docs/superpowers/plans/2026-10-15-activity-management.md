# Activity Management Implementation Plan

> **For agentic workers:** Execute sequentially in the current session; preserve the dirty checkout containing required TCX changes. No commit, push, development-database writes or environment changes.

**Goal:** Let owners edit titles/private notes and delete running records from activity details.

**Architecture:** Extend the existing PATCH route with strict metadata fields and retain visibility behavior. Add owner/CSRF protected DELETE using existing FK cascades and the common user-row serialization protocol. An isolated detail-page component owns drafts and the native delete dialog, with validated API helpers.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy/PostGIS, Svelte 5, Vitest, pytest, Playwright Chrome.

## Global Constraints

- Existing imported metrics are read-only. Titles 1–120 characters; notes 0–5000 characters and private.
- Mutations lock users before activities and increment activity_data_version in the same transaction.
- No schema migration; tests use synthetic records in a newly created isolated `_test` database only.
- Preserve existing uncommitted work; no external AI requests or Git publication.

### Task 1: API mutations and persistence

Files: backend/app/modules/activities/{schema,service,router}.py; backend/app/modules/sharing/{schema,router,service}.py; backend/tests/integration/test_activity_management.py.

Interfaces: PATCH /api/v1/activities/{id} accepts title/notes/visibility subsets, returns ActivityView with notes. DELETE returns data.deleted=true.

- [x] Add tests that PATCH metadata persists without altering metrics, rejects empty/unknown/null/oversized payloads, enforces ownership/CSRF, and preserves visibility sharing semantics.
- [x] Add parametrized GPX/TCX deletion tests checking source bytes/point/segment/share cascades, statistics, version increments, reimport and unknown IDs.
- [x] Run isolated tests before implementation and observe missing metadata/delete behavior.
- [x] Extend schema and existing PATCH without duplicate routes; implement serialized deletion and version update.
- [x] Run management, GPX, TCX, sharing and AI integration regressions.

### Task 2: Detail controls and API client

Files: frontend/src/lib/api/activities.ts; frontend/src/lib/components/ActivityActions.svelte; frontend/src/routes/activities/[id]/+page.svelte; frontend/tests/unit/activity-management.test.ts; frontend/tests/ui/activity-management.spec.ts; frontend/playwright.activity-management.config.ts.

Interfaces: updateActivity(id,{title,notes},fetcher) returns validated Activity; deleteActivity(id,fetcher) validates deleted=true. ActivityActions accepts activity and onupdated callback, navigates to /activities after deletion.

- [x] Add API tests for CSRF, payloads, malformed mutation responses and 401; add Chrome tests for draft retry/cancel, persistence after refresh, delete confirm/cancel/retry, keyboard and 320/390px overflow.
- [x] Run tests to observe absent client helpers and edit/delete controls.
- [x] Implement helpers and component; present notes as plain text and preserve drafts on failure. On successful save pass server response to parent; on successful delete perform full list navigation.
- [x] Run unit tests, svelte-check, production build and Chrome management plus existing activity/sharing regression.

### Task 3: Review and delivery

- [x] Inspect targeted diff and fresh git status; retain all unrelated changes.
- [x] Record verification and limits in docs/32-activity-management.md. Stop only the temporary test cluster started for this request.

## Verification

104 backend integration checks, 76 frontend unit checks, 13 Chrome fixture checks, 2 real Chrome/FastAPI/PostgreSQL checks passed; type check and build passed. Independent review returned no actionable findings. See docs/32-activity-management.md.
