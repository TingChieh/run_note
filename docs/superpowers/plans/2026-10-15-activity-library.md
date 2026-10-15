# Activity Library Implementation Plan

**Goal:** Icon-led metrics, footprint previews, inline metadata editing and batch deletion with automatic distance achievements.

**Architecture:** Reuse MetricSummary/RouteThumbnail; keep selection in the list and share an editor across detail/list. Persist private metadata in activities with an additive migration; batch delete validates all IDs under the existing user lock.

**Constraints:** Preserve unrelated work, metrics/auth/privacy; no commit/push. All writes in tests target isolated `_test` DB. Category <=30, tags <=10 of 1–30 characters; distance badges use actual 5000/10000/20000 m thresholds. Current-page selection only. Development migration requires explicit authorization.

### Task 1: Large icon metrics

- [x] Extend MetricSummary icons for heart/calories/steps; present all detail metrics uniformly, retaining separate device and elapsed durations.
- [x] Add browser assertions for values, missing/zero handling, icon/large type and narrow overflow. Keep route usable with taller metric panel.

### Task 2: Activity card and distance achievements

- [x] Add pure highest-distance achievement helper with exact threshold tests.
- [x] Add lazy RouteThumbnail, category/tags/chip, selectable checkbox, edit/delete callbacks to ActivityCard; keep navigation a separate link without nested controls.
- [x] Verify private source rendering, unavailable-route fallback and layout.

### Task 3: Backend private labels and batch delete

- [x] Add failing integration tests for category/tags persistence/strict validation/private public allowlist and all-or-nothing batch delete owner/CSRF/duplicate/limit/concurrency behavior.
- [x] Add 0008_activity_labels upgrade/downgrade, model and response/update fields; normalize labels server-side, preserve omitted fields.
- [x] Add POST /activities/batch-delete and serialized atomic service; revise integration revision guards to current head.
- [x] Migrate only isolated test DB, run relevant integration and schema migration checks.

### Task 4: List workflow and shared editor

- [x] Add failing API/browser tests for labels payload, list edit dialog, multi-selection/select-page/clear, confirmation/cancel, failed retry, paging and thumbnail rendering.
- [x] Add ActivityEditor shared form, list management dialog and current-page selection; update card data on save and reload/clamp page on deletion.
- [x] Run frontend unit/type/build and Chrome fixture plus true backend/browser tests; visual-check desktop/mobile/dark.

### Task 5: Review and runtime enablement

- [x] Independently review scoped changes; fix actionable issues and run affected checks.
- [x] User authorized upgrade with no backend start. Fresh backup restored and rehearsed in isolation; development upgraded to 0008 with data/constraint/PostGIS preservation checks and Alembic model parity. Backend stays stopped.
- [x] Document evidence, preserve dirty state and stop temporary Chrome/HTTP/PostgreSQL services.

### Follow-up: Compact cards and explicit editing mode

- [x] Observe browser failures for default control visibility and oversized route preview.
- [x] Gate selection/card management on explicit edit mode; clear selection on finishing and preserve pending-write protection.
- [x] Restore compact card structure with optional small RouteThumbnail appearance, leaving wall previews unchanged.
- [x] Update existing browser flows, verify type/build and focused Chrome layout/interaction regressions, and inspect screenshots. 32 Chrome fixture tests and 103 unit tests pass; type check/build pass; desktop/mobile-dark screenshots inspected. No backend start/restart or database operations for this follow-up.
