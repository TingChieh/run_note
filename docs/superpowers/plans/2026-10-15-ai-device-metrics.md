# AI Device Metrics Implementation Plan

Goal: implement approved device-metric AI summaries and historic-report compatibility with no migration or paid provider calls.
Constraints: same dirty checkout; no commits, pushes, secrets changes, production access or real-file imports. Spec: docs/superpowers/specs/2026-10-15-ai-device-metrics-design.md. Execute continuously under existing user authorization.

### Task 1: Backend aggregate snapshot and provider

Files: backend/app/modules/ai_reports/{snapshot.py,device_metrics.py,provider.py}; backend/tests/integration/test_ai_reports.py; backend/tests/unit/test_ai_provider.py.

- [x] Add failing integration tests via real existing isolated TEST_DATABASE_URL: four owner activities (600s/HR120/100kcal/1000steps; 600s timer overriding 1200s wall/HR180/unknown calories/0steps; no duration/HR200/0kcal/unknown steps; legacy no metrics), expected weighted HR150, weighted count2, HR count3, duration1200.000, calories100/count2, steps1000/count2. Another owner's extreme metrics and boundary dates must be excluded. Check weeks, empty weeks, immutable stored snapshots, old snapshots read, no provider call on preview. Keep zero duration out of weighting.
- [x] Add failing nested-whitelist test inserting raw_tcx/GPS/identity at top and week device_metrics; only specified scalar keys survive request_body.
- [x] Implement owner/date-filtered SQL aggregation with weekly grouping; round Decimal using HALF_EVEN to .001; attach device_metrics to v2 snapshots and each week. Existing statistics API schema unchanged.
- [x] Update provider allowlist and running-qualitative-v2 prompt, including coverage, estimate, no HR zones/cadence or cross-metric causal claims. Reuse existing output safety validation.
- [x] Verify focused integration and unit tests against guarded isolated DB; no dev writes. Run lint/format and full backend suite after frontend lands.

### Task 2: Frontend metrics, consent, legacy reports

Files: frontend/src/lib/api/ai.ts; frontend/src/lib/components/AnalysisFacts.svelte; frontend/src/routes/ai/+page.svelte; frontend/tests/unit/ai.test.ts; frontend/tests/ui/ai-device-metrics.spec.ts; frontend/playwright.ai-metrics.config.ts; frontend/tests/ui/p2.spec.ts (empty state label only).
Read design doc first for exact DeviceMetrics contract.

- [x] Add failing parseReport tests for valid v2, preserved v1, invalid/null/incomplete/negative/count overflow device metrics. Add Chrome tests for rendered known/missing/zero values, coverage, weekly data, v1 historic report, updated consent and no POST before explicit generation, keyboard access and mobile overflow.
- [x] Extend Snapshot schema_version union and DeviceMetrics types. Require valid metrics in v2 top-level and every week. Validate count <= corresponding activity_count, weighted_count <= HR count, count0 => null and positive count => nonnull; HR weighted count0 => duration/HR null; otherwise positive duration and HR1..300. Counts/calories/steps integers, nonnegative, finite; decimal duration and HR allow strings/numbers. Reject unexpected incomplete v2 gracefully.
- [x] Render overall cards and weekly device table with readable coverage labels. Explicitly label known-record calories/steps subtotals and HR duration weighting. v1 omits device cards and shows legacy note. Keep existing theme work and existing activity/AI access controls intact.
- [x] Update consent to include aggregated HR/calories/steps/coverage while excluding raw GPX/TCX/GPS/identity; empty import link GPX / TCX. Preserve manual consent and request-key retry.
- [x] Run pnpm test/check/build, dedicated Chrome config (extends existing UI config selecting new spec and p2.spec.ts). Preserve screenshots under ignored .cache/ai-device-metrics. No real-provider calls, no new migration or developer data writes.

### Task 3: Final review, runtime and documentation

- [x] Read-only independent review of task changes for aggregation math/privacy/compatibility; fix actionable findings with regressions.
- [x] Verify all unaffected dirty files match /tmp/runnote-ai-v2-baseline.json; git diff --check; document test pass/skip and mock boundary.
- [x] Restart already authorized local backend using ./backend.command restart and verify /api/v1/health/ready, current prompt version via code and no real generation. Update docs/31-ai-device-metrics.md and checklist with exact results; report completion.

## Completion evidence

Backend: 380 passed, 1 skipped (missing isolated snapshot DB); lint/format passed. Frontend: 74 unit passed; check 0/0; build passed. Chrome: 13 passed; screenshot-specific rerun 2 passed. Unit/integration RED cases were observed for missing v2 behavior before implementation; browser tests are post-implementation acceptance. Independent code review clean. Local backend restarted and readiness verified, no migration/real AI call. Full details: docs/31-ai-device-metrics.md.
