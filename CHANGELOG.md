# Changelog

All notable changes to RunNote (Web, Backend, and Android Companion) are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and RunNote adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (`MAJOR.MINOR.PATCH` and `-(alpha|beta|rc).N` prereleases):
- Routine small updates and bug fixes use **patch** increments (`2.6.1`, `2.6.2`, …, `2.6.10`, up to `99`).
- Backwards-compatible feature updates use **minor** increments, including multi-digit minors (`2.10.0`, `2.11.0`, …, up to `2.99.0`); never collapse `2.10.0` to `2.1.0` and never zero-pad (e.g., `2.010.0` is invalid).
- **Major** increments are reserved for true major/breaking releases.
- `alpha` / `beta` / `rc` prereleases stay monotonically ordered before their target final release.

> **Release history note**: Prior to establishing the automated `v*` GitHub Release pipeline, RunNote tracked versions in `backend/pyproject.toml` (starting at `1.0.0` in PR #96) and deployed native server tarballs without Git tags or GitHub Releases. Historical entries below reflect real merged commits and PRs; formal Git tags and GitHub Releases begin with the first maintainer-authorized `v*` tag.

## [Unreleased]

## [2.7.0] - 2026-11-28

### Added
- **Unified Version Management & Automated Release Pipeline** (#159):
  - Added repository-root `VERSION` as the single source of truth across Web (`frontend/package.json`), Backend (`backend/pyproject.toml`), and Android (`android/package.json` and `android/native/app/build.gradle`), managed by `scripts/version.py` (`show`, `check`, `sync`, `set`, `bump`, `validate-tag`, `verify-cert-pin`).
  - Added SemVer prerelease support (`alpha` / `beta` / `rc`) across backend `/api/v1/admin/version`, frontend version/capabilities parsing, and a strictly monotonic Android `versionCode` formula (`MAJOR * 10_000_000 + MINOR * 100_000 + PATCH * 1_000 + STAGE_CODE`, where `alpha.N = 100+N`, `beta.N = 200+N`, `rc.N = 300+N`, final `= 999`).
  - Added `v*` tag-triggered GitHub Actions release workflow (`.github/workflows/release.yml`) with SemVer/manifest/changelog/non-overwrite validation, full backend/frontend/infra/Android quality and compatibility gates, secret-backed Android release APK signing, `aapt2`/`apksigner`/permission verification, SHA-256 checksums, and atomic draft-to-published GitHub Release creation.
  - Added `CHANGELOG.md` and standalone release operations guide (`docs/102-release-pipeline.md`).
- **Mobile Offline Shell & Native Bearer Auth** (#156, #157):
  - Added backend mobile bearer authentication (`/api/v1/mobile/auth/login`, `/refresh`, `/logout`), opaque token rotation with replay revocation, `GET /api/v1/client/capabilities` version/feature negotiation, and Alembic migration `0035_mobile_sessions`.
  - Added static mobile bundle build (`pnpm build:mobile` into `android/public`), Android `RunNoteTransport` native plugin with Android Keystore token storage, APK minimal-permission audit (`android/scripts/audit-apk-permissions.py`), and Android CI job.
- **Editorial Receipt Design — Foundation & Mobile Six-Screen Experience** (#158, #174):
  - Introduced shared Editorial Receipt foundation tokens, paper/receipt/ledger primitives, and refreshed the Web Data Summary page (`/dashboard`), removing the redundant floating phone top bar below `800px` (`docs/101-editorial-receipt-phase1.md`).
  - Delivered the Editorial Receipt mobile six-screen experience (`docs/107-editorial-receipt-mobile.md`):
    - **Home (`/dashboard`)**: `<800px` goal ordering (`week → streak → month → year`) and a `<640px` 7-day stacked-block weekly punch card (`week-punch.ts`) cached independently of the browsed calendar year, handling cross-year weeks and rendering an active dot with zero blocks for missing- or zero-distance active days.
    - **Pre-run (`/activities/record`)**: High-contrast GPS accuracy readout, ruled pre-run checklist, sticky primary start action, and flat hairline upload queue.
    - **Outdoor Recording & Paused (`/activities/record`)**: `<800px` immersive high-contrast mode with a single-line status indicator (recording state, GPS accuracy, offline badge), `min(8.5rem, 31vw)` hero distance, two-column `3.25rem` duration/pace figures, touch-lock button, native live per-km split extraction (`recording-splits.ts` with 7-decimal point backfill, bounded 2-retry bridge recovery, in-place stationary timing, pause-segment isolation, 950–999 m partial-tail labeling, and full-km-only fastest-split comparison), plus a paused resume action and 1.5-second hold-to-finish-and-save with a WCAG 2.5.1 safe-area-centered confirmation dialog kept visible above the fold at `320×640`.
    - **Done Receipt (`/activities/record`)**: Serrated receipt sheet (`.receipt-sheet.receipt-serrated`) on `--desk` with per-km split preview, fastest full-km highlight, honest sync `.status-strip`, and automatic scroll-to-top after save.
    - **Activity Detail (`/activities/[id]`)**: `<800px` map-first layout with aligned visual, DOM, and keyboard Tab order (`map → toolbar → stub → pace`), `<640px` edge-to-edge map canvas (without clipping basemap notices), and a 3-column hairline core summary promoting average heart rate into the top three metrics.
    - **Share Dialogs (`StoryShareDialog`, `RecapShare`, `ActivityPosterDialog`)**: Aligned with Editorial Receipt styling while retaining `data-glass-overlay`, resolved `.underline-tabs > button` glass contrast conflicts in `liquid-glass.css`, and ensured the PNG save action stays visible above the fold at `320×640`.
- **Extended Synthetic-API Browser CI Suite** (#175):
  - Added a parallel `frontend-ui-extended` Playwright CI job (`frontend/playwright.ui-extended.config.ts`, also wired into `scripts/verify.py --full`) covering `route-groups.spec.ts`, `wellbeing.spec.ts`, and `together.spec.ts` so `frontend-ui` remains comfortably within its timeout.

### Changed
- **Editorial Receipt Web Migration Across All Routes** (#160, #161, #162, #163, #164, #168, #169, #170, #171):
  - **Activities & Activity Detail** (#160, #161): Migrated `/activities` (plus workspace/public aliases) to the `ledger` table layout with whole-page GPX/TCX drag-and-drop import, and migrated `/activities/[id]` (plus `PublicActivityPage`) to the receipt stub + 560 px `RouteMap appearance="sheet"`, replay-backed `ActivityPaceChart` with per-km split bars and `<details>` data table, hairline sub-sections, and delete moved into the More (`...`) menu (`docs/102-editorial-receipt-activities.md`, `docs/103-editorial-receipt-activity-detail.md`).
  - **Footprints & City Exploration** (#162): Migrated `/footprints` and `/footprints/exploration` (and aliases) to underline view tabs, `FootprintMap`/`ExplorationMap` `appearance="sheet"` with `data-glass-overlay` controls, a two-column exploration ledger with 3-part summary, city atlas with distance ratio bars, and coverage trend bars (`docs/104-editorial-receipt-footprints.md`).
  - **Running Recap, Records & Annual Story** (#163, #168): Migrated `/workspace/records/recap` to the receipt paper sheet with punch-card rhythm, hairline distribution/rhythm panels, and persistent `RecapShare` poster dock (`docs/105-editorial-receipt-report.md`); migrated `/records` (and aliases) with `RecordsBanner appearance="ledger"`, `RecordsChart appearance="receipt"`, and hairline `PeriodReportCard`, and `/workspace/records/story` with a receipt-paper prologue, chapter rules (01–05), underline year/chapter tabs, and `StoryShareDialog` (`data-glass-overlay`).
  - **Routes & Together** (#169): Migrated `/routes`, `/routes/[id]`, and `/together` (and aliases) to underline sorting/period tabs, ledger `RouteGroupCard`, `RouteMap appearance="sheet"`, Editorial Receipt `RouteGroupTrend`, and `/together` milestone hero + 4 px leaderboard bars + `FootprintMap appearance="sheet"` + `TogetherRecordSheet` (`data-glass-overlay`).
  - **AI Assistant & Wellbeing** (#170): Migrated `/ai` (and `/workspace/ai`) to a two-column ruled workspace with hairline session ledger, monospace quota text, `.status-strip` notices/disclaimers, dot-state consent card, and `TrendChart appearance="receipt"`; aligned `/wellbeing` (and `/workspace/wellbeing`) header, 5-section underline tabs, ruled trend/summary headers, paper history/notes, and hairline export section while intentionally preserving `--well-*` color tokens, dial/ring controls, and the floating Liquid Glass `SaveBar`.
  - **Settings Hub, Admin, Privacy & Remaining Web Routes** (#164, #171): Migrated `/settings`, `/settings/shoes`, `/settings/preferences`, `/settings/site`, and `/admin/users` (and workspace aliases) to operational Editorial Receipt layouts with underline `SettingsTabs`, flat `SaveBar`, and hairline form/table groups (`docs/106-editorial-receipt-settings.md`); completed the remaining-route migration and full route audit (`docs/107-editorial-receipt-remaining-web.md`) covering the `/admin` logged-in hub, anonymous login (`AuthForm`, kept outside `.editorial-page` so the submit button preserves the Liquid Glass contract), `/admin/users/[id]/activities` and activity detail (`AdminActivityPage`), `/privacy` (8 ruled sections and deletion callout preserving legal disclosures), and `/activities/record` / `/workspace/activities/record` Web operational cleanup.
- **Version Source & `RELEASE` Metadata** (#159):
  - Updated `VERSION` from the prior `2.6.0` baseline to `2.7.0`, bringing drifted `android/package.json` (`2.5.0`) back into sync across all platforms.
  - Updated `infra/native/ops/build-release.sh` to include `version=<semver>` in the generated `RELEASE` metadata file alongside `id`, `git_sha`, `built_at`, and `node`.
  - Updated Android unit test `ServerUrlPolicyTest` to verify `BuildConfig.VERSION_NAME` and `BuildConfig.VERSION_CODE` directly against root `VERSION`.
  - Expanded `.gitignore` and `android/.gitignore` to block keystores, base64-encoded keystores, signing property files, and built APKs/AABs from being committed.

### Fixed
- **Routes Detail Run Table & CI Timeout** (#173, follow-up to #169):
  - Switched `/routes/[id]` run table to `table-layout: fixed` with responsive column widths and wrapping on the title/date columns so date, distance, duration, and pace stay visible without horizontal overflow across 320/390/768/1440 px (including 6-char and 120-char titles).
  - Restored `aria-live="polite"` result-count announcements on `/routes`, restored `/settings` underline section-tab navigation coverage in `top-navigation.spec.ts`, updated stale design-system/settings docs that still described `/routes` sorting or `/settings` sections as glass segments, and raised the `frontend-ui` CI job `timeout-minutes` from 30 to 45.
- **Editorial Receipt Audit P2/P3 Fixes & Test Isolation** (#175):
  - Aligned `<800px` `GoalOverview` DOM, keyboard Tab, and screen-reader order (`week → streak → month → year`) with visual layout via responsive keyed rendering instead of CSS-only reordering.
  - Hardened mobile `RecordingWorkspace` 1.5-second hold-to-finish flag cleanup so a failed stop does not swallow a subsequent tap, and unified `findFastestFullSplit` with `row.fastest` (requiring at least two complete 1,000 m splits with a ≥0.5 s pace spread).
  - Updated `/workspace/records/story` chapter index tabs from `aria-current="page"` to `aria-current="location"` with matching `.underline-tabs` active and `forced-colors` styles.
  - Enforced a 44×44 px (`2.75rem`) minimum touch target on the `AuthForm` password visibility toggle.
  - Reset the synthetic `ui-api` test fixture's admin user timezone to `Asia/Shanghai` on login to avoid cross-test timezone leakage.
- **Recap Report & Settings Hub Follow-ups** (#165, #167):
  - Fitted the `/workspace/records/recap` sticky share desk within `1440×768` viewports (including `scrollY = 0`) and hatched ongoing partial punch-card months, including zero-distance ongoing months (#165).
  - Restored Editorial Receipt settings focus/error states, 44 px compact buttons on `/admin/users`, and `/settings/site` `SaveBar` sticky scope (#167).
- **Mobile Safe-Area Layout** (#155):
  - Respected the bottom safe-area inset on pages where the mobile bottom tab bar is hidden.

### Breaking
- None. Existing Web session auth, public showcase endpoints, and non-Docker native deployment layouts remain compatible.

### Upgrade notes
- **Database migration required (`0035_mobile_sessions`)**: Upgrading from `2.6.0` (`0034_drop_ai_reports`) adds the `mobile_sessions` table and extends the auth rate-limit scope constraint with `mobile-refresh-ip`. Take a verified backup and deploy with `--migrate` (`infra/native/ops/ship.py --migrate` or `ops/deploy.sh --migrate`).
- **Android `versionCode` jump**: Moving from the legacy `MAJOR * 10000 + MINOR * 100 + PATCH` scheme (`20600` for `2.6.0`) to the monotonic prerelease-capable scheme (`20700999` for `2.7.0`) is strictly increasing, so existing Android installations upgrade in place without uninstalling provided the same release signing keystore is used.
- **Mobile client floor**: `GET /api/v1/client/capabilities` reports `min_mobile_app_version = "2.6.0"` and `mobile_api_version = 1`.
- **GitHub Release secrets (one-time maintainer setup)**: Configure `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, and `ANDROID_RELEASE_SERVER_URL` (plus recommended `ANDROID_SIGNING_CERT_SHA256` certificate fingerprint pinning) in repository secrets/variables before pushing the first `v*` tag (see `docs/102-release-pipeline.md`).

---

## [2.6.0] - 2026-11-26 (untagged baseline, commit `0212004`)

> Recorded as the pre-pipeline baseline on `main` (PR #152); no Git tag or GitHub Release was published for this version.

### Added
- **Mobile Phone Shell** (#152): Added the mobile 4+1 bottom tab bar shell and responsive mobile navigation (`docs/100-mobile-shell-navigation.md`).

### Changed
- **Android Version Alignment** (#152, #154): Bumped `backend/pyproject.toml`, `frontend/package.json`, and `android/native/app/build.gradle` to `2.6.0` (`versionCode 20600`) after prior Android Companion Phase 1–3 milestones (`2.3.0` #144, `2.4.0` #145, `2.5.0` #146, `2.5.1` #153/#154).

### Fixed
- **Reachable Login & Health Refresh** (#150, #151, #153): Added a reachable login entry in the public shell, public privacy policy and data deletion request flow, and Health Connect permission/summary refresh on foreground return (landed in the `2.5.x` commits leading into `2.6.0`).

### Breaking
- None.

### Upgrade notes
- Earlier pre-tag version history (`1.0.0` through `2.5.1`) is documented across `docs/88-version-info.md` through `docs/99-android-capacitor-phase3.md` and the merged PR history on `main`.
