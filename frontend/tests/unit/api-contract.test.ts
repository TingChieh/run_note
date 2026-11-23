import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_OPERATIONS } from '../../src/lib/api/generated/api.ts';

// Every '/api/...' URL the frontend (or the synthetic UI API) spells out must name a real backend
// route, and every literal query parameter must be one that route accepts. The route list comes
// from the generated contract (backend/app/contract/typescript.py), so a removed or renamed
// endpoint, or a `page=` where the backend wants `offset=`, fails here instead of in production.

const ROOT = join(import.meta.dirname, '../..');
const SKIP = new Set(['src/lib/api/generated', 'src/lib/data', 'src/lib/vendor']);
const SOURCES = ['src', 'tests/fixtures/ui-api.mjs'];
const operations: Record<string, Record<string, readonly string[]>> = API_OPERATIONS;
// Literals that are not requests, with the reason. Keep this list short.
const NOT_REQUESTS = new Map([
  ['tests/fixtures/ui-api.mjs|/api/v1/running-goals', 'intermediate value while mapping showcase paths to owner paths'],
]);
// Query parameters a route ignores on purpose.
const IGNORED_QUERY: Record<string, string[]> = {
  '/api/v1/me/avatar': ['v'], // cache-busting version appended by the backend (users/service.py)
};
const templates = Object.keys(operations);

type Part = string | null; // null stands for a `${...}` expression
interface Literal {
  where: string;
  text: string;
  parts: Part[];
}

function files(path: string): string[] {
  const rel = relative(ROOT, path);
  if (SKIP.has(rel)) return [];
  if (/\.(ts|js|mjs|svelte)$/.test(path)) return [path];
  try {
    return readdirSync(path, { withFileTypes: true }).flatMap((entry) => files(join(path, entry.name)));
  } catch {
    return [];
  }
}

function skipQuoted(src: string, i: number): number {
  const quote = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') j++;
    else if (src[j] === quote) return j + 1;
  }
  return src.length;
}

function skipExpression(src: string, i: number): number {
  let depth = 1;
  for (let j = i; j < src.length;) {
    const c = src[j];
    if (c === "'" || c === '"') j = skipQuoted(src, j);
    else if (c === '`') j = readTemplate(src, j).end;
    else {
      if (c === '{') depth++;
      if (c === '}' && --depth === 0) return j + 1;
      j++;
    }
  }
  return src.length;
}

function readTemplate(src: string, i: number): { parts: Part[]; end: number } {
  const parts: Part[] = [];
  let text = '';
  for (let j = i + 1; j < src.length;) {
    if (src[j] === '\\') {
      text += src.slice(j, j + 2);
      j += 2;
    } else if (src[j] === '`') {
      parts.push(text);
      return { parts, end: j + 1 };
    } else if (src[j] === '$' && src[j + 1] === '{') {
      parts.push(text, null);
      text = '';
      j = skipExpression(src, j + 2);
    } else text += src[j++];
  }
  return { parts, end: src.length };
}

function literals(path: string): Literal[] {
  const src = readFileSync(path, 'utf8');
  const found: Literal[] = [];
  for (const match of src.matchAll(/(['"`])\/api\//g)) {
    const start = match.index;
    const parts =
      match[1] === '`' ? readTemplate(src, start).parts : [src.slice(start + 1, skipQuoted(src, start) - 1)];
    const line = src.slice(0, start).split('\n').length;
    const text = parts.map((part) => (part === null ? '${…}' : part)).join('');
    found.push({ where: `${relative(ROOT, path)}:${line}`, text, parts: parts.filter((part) => part !== '') });
  }
  return found;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const templateRegex = (template: string) => new RegExp(`^${escape(template).replace(/\\\{[^}]+\\\}/g, '[^/]+')}$`);

function split(parts: Part[]): { path: Part[]; query: string[] } {
  const path: Part[] = [];
  const query: string[] = [];
  let inQuery = false;
  for (const part of parts) {
    if (inQuery) {
      if (part !== null) query.push(part);
    } else if (part !== null && /[?#]/.test(part)) {
      const at = part.search(/[?#]/);
      path.push(part.slice(0, at));
      query.push(part.slice(at));
      inQuery = true;
    } else path.push(part);
  }
  return { path: path.filter((part) => part !== ''), query };
}

function matches(path: Part[]): string[] {
  const last = path.at(-1);
  // A literal ending in '/' is a prefix the code appends to ('/api/v1/activities/' + id).
  const prefix = typeof last === 'string' && last.endsWith('/');
  if (path.includes(null) || prefix) {
    const body = path.map((part) => (part === null ? '.*?' : escape(part))).join('');
    const pattern = new RegExp(`^${body}${prefix ? '' : '$'}`);
    return templates.filter((template) => pattern.test(template));
  }
  const text = path[0] as string;
  const exact = templates.filter((template) => templateRegex(template).test(text));
  // Otherwise a base constant such as BASE = '/api/v1/me/wellbeing' must start real routes.
  return exact.length ? exact : templates.filter((template) => template.startsWith(`${text}/`));
}

function check(literal: Literal): string | null {
  if (NOT_REQUESTS.has(`${literal.where.replace(/:\d+$/, '')}|${literal.text}`)) return null;
  const { path, query } = split(literal.parts);
  const routes = matches(path);
  if (!routes.length) return `${literal.where} unknown endpoint ${literal.text}`;
  const accepted = new Set(
    routes.flatMap((route) => [...Object.values(operations[route]).flat(), ...(IGNORED_QUERY[route] ?? [])]),
  );
  const names = query.flatMap((chunk) => [...chunk.matchAll(/(?:^|[?&])([A-Za-z_]\w*)=/g)].map((m) => m[1]));
  const unknown = names.filter((name) => !accepted.has(name));
  return unknown.length ? `${literal.where} unknown query parameter(s) ${unknown.join(', ')} in ${literal.text}` : null;
}

const all = SOURCES.flatMap((source) => files(join(ROOT, source))).flatMap(literals);

describe('frontend API usage matches the generated backend contract', () => {
  it('finds the API literals it is meant to check', () => {
    expect(all.length).toBeGreaterThan(100);
  });

  it('only calls endpoints and query parameters the backend defines', () => {
    // Fix: correct the URL, or if the backend changed, regenerate the contract with
    // `cd backend && .venv/bin/python -m app.contract.typescript`.
    expect(all.map(check).filter(Boolean)).toEqual([]);
  });

  it('rejects an endpoint or query parameter that does not exist', () => {
    const probe = (text: string, parts: Part[]) => check({ where: 'probe', text, parts });
    expect(probe('/api/v1/activities?page=1', ['/api/v1/activities?page=1'])).toMatch(/unknown query/);
    expect(probe('/api/v1/nothing', ['/api/v1/nothing'])).toMatch(/unknown endpoint/);
    expect(probe('/api/v1/activities/${…}/route', ['/api/v1/activities/', null, '/route'])).toBeNull();
    expect(probe('/api/v1/activities/abc/route', ['/api/v1/activities/abc/route'])).toBeNull();
  });
});
