import { ActivityError, request } from './activities.ts';

export class VersionError extends Error {
  constructor(
    message: string,
    public status = 502,
    public code = 'INVALID_RESPONSE',
  ) {
    super(message);
  }
}
export type VersionBuild = { release_id: string; git_sha: string; built_at: string };
export type VersionInfo = { version: string; build: VersionBuild | null };

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const matches = (pattern: RegExp, value: unknown): value is string => typeof value === 'string' && pattern.test(value);
// Same shapes as backend/app/modules/version/service.py; the backend never sends anything else.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.([1-9]\d*))?$/,
  RELEASE_ID = /^\d{14}-[0-9a-f]{12}(-dirty)?$/,
  GIT_SHA = /^[0-9a-f]{12}(-dirty)?$/,
  BUILT_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
function invalid(): never {
  throw new VersionError('版本信息服务返回了无效响应');
}

export function parseVersion(value: unknown): VersionInfo {
  if (!object(value) || !matches(SEMVER, value.version)) invalid();
  if (value.build === null) return { version: value.version, build: null };
  const build = value.build;
  if (
    !object(build) ||
    !matches(RELEASE_ID, build.release_id) ||
    !matches(GIT_SHA, build.git_sha) ||
    !matches(BUILT_AT, build.built_at)
  )
    invalid();
  return {
    version: value.version,
    build: { release_id: build.release_id, git_sha: build.git_sha, built_at: build.built_at },
  };
}

export async function readVersion(fetcher: typeof fetch = fetch): Promise<VersionInfo> {
  try {
    return parseVersion(await request('/api/v1/admin/version', {}, fetcher));
  } catch (cause) {
    if (cause instanceof ActivityError) throw new VersionError(cause.message, cause.status, cause.code);
    throw cause;
  }
}

/** `2026-11-19T16:37:55Z` → `2026-11-19 16:37 UTC` (the build clock is UTC; no local conversion). */
export const builtAtLabel = (value: string) => `${value.slice(0, 10)} ${value.slice(11, 16)} UTC`;
