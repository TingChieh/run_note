# Changelog

All notable changes to RunNote (Web, Backend, and Android Companion) are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and RunNote adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (`MAJOR.MINOR.PATCH` and `-(alpha|beta|rc).N` prereleases):
- Routine small updates and bug fixes use **patch** increments (`2.6.1`, `2.6.2`, …, `2.6.10`, up to `99`).
- Backwards-compatible feature updates use **minor** increments, including multi-digit minors (`2.10.0`, `2.11.0`, …, up to `2.99.0`); never collapse `2.10.0` to `2.1.0` and never zero-pad (e.g., `2.010.0` is invalid).
- **Major** increments are reserved for true major/breaking releases.
- `alpha` / `beta` / `rc` prereleases stay monotonically ordered before their target final release.

> **Release history note**: Prior to establishing the automated `v*` GitHub Release pipeline, RunNote tracked versions in `backend/pyproject.toml` (starting at `1.0.0` in PR #96) and deployed native server tarballs without Git tags or GitHub Releases. Historical entries below reflect real merged commits and PRs; formal Git tags and GitHub Releases begin with the first maintainer-authorized `v*` tag.

## [Unreleased]

Target next release: `2.7.0` (Android `versionCode`: `20700999`). No Git tag or GitHub Release has been created yet; promote this section to `## [2.7.0] - YYYY-MM-DD` when the maintainer authorizes cutting `v2.7.0`.

### Added
- **Unified Version Management & Automated Release Pipeline**:
  - Added repository-root `VERSION` as the single source of truth across Web (`frontend/package.json`), Backend (`backend/pyproject.toml`), and Android (`android/package.json` and `android/native/app/build.gradle`), managed by `scripts/version.py` (`show`, `check`, `sync`, `set`, `bump`, `validate-tag`).
  - Added SemVer prerelease support (`alpha` / `beta` / `rc`) across backend `/api/v1/admin/version`, frontend version/capabilities parsing, and a strictly monotonic Android `versionCode` formula (`MAJOR * 10_000_000 + MINOR * 100_000 + PATCH * 1_000 + STAGE_CODE`, where `alpha.N = 100+N`, `beta.N = 200+N`, `rc.N = 300+N`, final `= 999`).
  - Added `v*` tag-triggered GitHub Actions release workflow (`.github/workflows/release.yml`) with SemVer/manifest/changelog/non-overwrite validation, full backend/frontend/infra/Android quality and compatibility gates, secret-backed Android release APK signing, `aapt2`/`apksigner`/permission verification, SHA-256 checksums, and atomic draft-to-published GitHub Release creation.
  - Added `CHANGELOG.md` and standalone release operations guide (`docs/102-release-pipeline.md`).
- **Mobile Offline Shell & Native Bearer Auth** (#156, #157):
  - Added backend mobile bearer authentication (`/api/v1/mobile/auth/login`, `/refresh`, `/logout`), opaque token rotation with replay revocation, `GET /api/v1/client/capabilities` version/feature negotiation, and Alembic migration `0035_mobile_sessions`.
  - Added static mobile bundle build (`pnpm build:mobile` into `android/public`), Android `RunNoteTransport` native plugin with Android Keystore token storage, APK minimal-permission audit (`android/scripts/audit-apk-permissions.py`), and Android CI job.
- **Editorial Receipt Design — Phase 1** (#158):
  - Introduced shared Editorial Receipt foundation tokens/surfaces and refreshed the Web Data Summary page (`docs/101-editorial-receipt-phase1.md`).

### Changed
- **Version Source & `RELEASE` Metadata**:
  - Updated `VERSION` from the prior `2.6.0` baseline to `2.7.0`, bringing drifted `android/package.json` (`2.5.0`) back into sync across all platforms.
  - Updated `infra/native/ops/build-release.sh` to include `version=<semver>` in the generated `RELEASE` metadata file alongside `id`, `git_sha`, `built_at`, and `node`.
  - Updated Android unit test `ServerUrlPolicyTest` to verify `BuildConfig.VERSION_NAME` and `BuildConfig.VERSION_CODE` directly against root `VERSION`.
  - Expanded `.gitignore` and `android/.gitignore` to block keystores, base64-encoded keystores, signing property files, and built APKs/AABs from being committed.

### Fixed
- **Routes Detail Run Table & Follow-up** (#169 follow-up): Switched `/routes/[id]` run table to `table-layout: fixed` with responsive column widths and wrapping on the title/date columns so date, distance, duration, and pace stay visible without horizontal overflow across 320/390/768/1440px (including 6-char and 120-char titles); restored `aria-live="polite"` result-count announcements on `/routes`; restored `/settings` underline section-tab navigation coverage in `top-navigation.spec.ts`; updated stale design-system/settings docs that still described `/routes` sorting or `/settings` sections as glass segments; raised `frontend-ui` CI job `timeout-minutes` from 30 to 45.
- **Mobile Safe-Area Layout** (#155):
  - Respected the bottom safe-area inset on pages where the mobile bottom tab bar is hidden.

### Breaking
- None. Existing Web session auth, public showcase endpoints, and non-Docker native deployment layouts remain compatible.

### Upgrade notes
- **Database migration required (`0035_mobile_sessions`)**: Upgrading from `2.6.0` (`0034_drop_ai_reports`) adds the `mobile_sessions` table and extends the auth rate-limit scope constraint with `mobile-refresh-ip`. Take a verified backup and deploy with `--migrate` (`infra/native/ops/ship.py --migrate` or `ops/deploy.sh --migrate`).
- **Android `versionCode` jump**: Moving from the legacy `MAJOR * 10000 + MINOR * 100 + PATCH` scheme (`20600` for `2.6.0`) to the monotonic prerelease-capable scheme (`20700999` for `2.7.0`) is strictly increasing, so existing Android installations upgrade in place without uninstalling provided the same release signing keystore is used.
- **Mobile client floor**: `GET /api/v1/client/capabilities` reports `min_mobile_app_version = "2.6.0"` and `mobile_api_version = 1`.
- **GitHub Release secrets (one-time maintainer setup)**: Configure `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, and `ANDROID_RELEASE_SERVER_URL` in repository secrets before pushing the first `v*` tag (see `docs/102-release-pipeline.md`).

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
