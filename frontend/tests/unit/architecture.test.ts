import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Executable form of the frontend rules in AGENTS.md section 5. Each failure names the file and
// the rule; fix the code rather than adding an exception here.

const ROOT = join(import.meta.dirname, '../..');
const SKIP = new Set(['src/lib/api/generated', 'src/lib/data', 'src/lib/vendor']);

function files(path: string): string[] {
  if (SKIP.has(relative(ROOT, path))) return [];
  if (/\.(ts|js|svelte)$/.test(path)) return [path];
  try {
    return readdirSync(path, { withFileTypes: true }).flatMap((entry) => files(join(path, entry.name)));
  } catch {
    return [];
  }
}

const sources = files(join(ROOT, 'src')).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, 'utf8'),
}));

function violations(pattern: RegExp, allowed: (path: string) => boolean = () => false): string[] {
  return sources.flatMap(({ path, text }) =>
    allowed(path)
      ? []
      : text.split('\n').flatMap((line, index) => (pattern.test(line) ? [`${path}:${index + 1}: ${line.trim()}`] : [])),
  );
}

const isServer = (path: string) =>
  path.startsWith('src/lib/server/') || /(\+page\.server|\+layout\.server|\+server|hooks\.server)\.ts$/.test(path);

describe('frontend architecture rules', () => {
  it('scans the source tree', () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it('uses runes and $app/state, not stores or event dispatchers', () => {
    expect(violations(/['"]\$app\/stores['"]|['"]svelte\/store['"]|createEventDispatcher/)).toEqual([]);
  });

  it('imports internal modules through #lib, not $lib', () => {
    expect(violations(/from ['"]\$lib\//)).toEqual([]);
  });

  it('loads maplibre-gl, echarts and three only on demand (SSR safety)', () => {
    // Static value imports are allowed only in *-runtime.ts modules, which are themselves only
    // reached through import(); `import type` is always fine.
    const heavy = /^\s*import\s+(?!type\b)[^(]*from\s+['"](maplibre-gl|echarts|three)(\/[^'"]*)?['"]/;
    expect(violations(heavy, (path) => path.endsWith('-runtime.ts'))).toEqual([]);
    expect(violations(/^\s*import\s+(?!type\b)[^(]*from\s+['"][^'"]*-runtime(\.ts)?['"]/)).toEqual([]);
  });

  it('never calls map.setStyle (theme changes go through paint properties)', () => {
    expect(violations(/\bmap\??\.setStyle\(/)).toEqual([]);
  });

  it('links markers to an issue and explains every suppression', () => {
    // AGENTS.md "注释": TODO/FIXME/HACK/XXX name a tracked issue, e.g. TODO(#12); a disabled check
    // says why. The project has no ESLint, and @ts-ignore hides errors that @ts-expect-error reports.
    expect(violations(/(\/\/|\/\*|<!--).*\b(TODO|FIXME|HACK|XXX)\b(?!\(#\d+\))/)).toEqual([]);
    expect(violations(/svelte-ignore [\w-]+(\s+[\w-]+)*\s*-->/)).toEqual([]);
    expect(violations(/@ts-ignore|eslint-disable|@ts-expect-error\s*$/)).toEqual([]);
  });

  it('keeps src/lib/server out of client code', () => {
    expect(violations(/from ['"](#lib|\.\.?)\/[^'"]*\bserver\/[^'"]*['"]/, isServer)).toEqual([]);
  });
});
