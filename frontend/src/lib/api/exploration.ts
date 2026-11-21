import type {
  ExplorationCatalog,
  ExplorationCells,
  ExplorationDetail,
  ExplorationPlace,
} from '#lib/api/generated/api.ts';
import { FootprintError } from '#lib/api/footprints.ts';

export type Scope = ExplorationDetail['scope'];
export type Layer = 'heatmap' | 'new';
export type Viewport = { bounds: [number, number, number, number]; zoom: number };
export type { ExplorationCatalog, ExplorationDetail, ExplorationCells };

const root = '/api/v1/me/footprints/exploration';
const invalid = () => new FootprintError('无法识别城市探索数据，请重试');
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const distance = (value: unknown) =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const nullableCount = (value: unknown) => value === null || integer(value);
const code = (value: unknown) => typeof value === 'string' && /^[\w-]{1,32}$/.test(value);
const label = (value: unknown) => typeof value === 'string' && value.length > 0;
const date = (value: unknown) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const version = (value: unknown): value is Record<string, unknown> =>
  object(value) &&
  integer(value.source_version) &&
  label(value.atlas_version) &&
  (value.status === 'ready' || value.status === 'pending' || value.status === 'failed');
const place = (value: unknown): value is ExplorationPlace =>
  object(value) &&
  code(value.code) &&
  label(value.name) &&
  (value.region_name === null || label(value.region_name)) &&
  (value.kind === 'boundary'
    ? value.distance_m !== null && distance(value.distance_m)
    : value.kind === 'nearby' && value.distance_m === null) &&
  date(value.first_date) &&
  date(value.last_date) &&
  String(value.first_date) <= String(value.last_date) &&
  integer(value.activity_count, 1);

export function parseCatalog(value: unknown): ExplorationCatalog {
  if (
    !version(value) ||
    !integer(value.total) ||
    !integer(value.limit, 1, 100) ||
    !integer(value.offset, 0, 1000000) ||
    !Array.isArray(value.items) ||
    value.items.length > value.limit ||
    !value.items.every(place) ||
    !Array.isArray(value.regions) ||
    !value.regions.every((v) => object(v) && code(v.code) && label(v.name)) ||
    ![
      value.activity_count,
      value.boundary_count,
      value.nearby_count,
      value.no_track_count,
      value.unmatched_count,
    ].every(nullableCount) ||
    !distance(value.distance_m) ||
    !distance(value.unallocated_m)
  )
    throw invalid();
  return value as unknown as ExplorationCatalog;
}

export function parseDetail(value: unknown): ExplorationDetail {
  if (
    !version(value) ||
    !['global', 'region', 'city'].includes(String(value.scope)) ||
    !code(value.code) ||
    !label(value.name) ||
    !integer(value.year, 1900, 2100) ||
    !(value.first_year === null || integer(value.first_year, 1900, 2100)) ||
    !(value.city === null || place(value.city)) ||
    ![value.new_cells, value.cumulative_cells].every(nullableCount) ||
    !Array.isArray(value.months) ||
    value.months.length !== 12 ||
    !value.months.every(
      (v, i) => object(v) && v.month === i + 1 && nullableCount(v.new_cells) && nullableCount(v.cumulative_cells),
    )
  )
    throw invalid();
  return value as unknown as ExplorationDetail;
}

export function parseCells(value: unknown): ExplorationCells {
  if (
    !version(value) ||
    !integer(value.block_size, 1, 1048576) ||
    !(
      value.bounds === null ||
      (Array.isArray(value.bounds) &&
        value.bounds.length === 4 &&
        value.bounds.every(
          (v, i) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= (i % 2 ? 86 : 180),
        ) &&
        value.bounds[0] < value.bounds[2] &&
        value.bounds[1] < value.bounds[3])
    ) ||
    !Array.isArray(value.cells) ||
    value.cells.length > 5000 ||
    !value.cells.every(
      (v) =>
        Array.isArray(v) &&
        v.length === 3 &&
        integer(v[0], -200376, 200376) &&
        integer(v[1], -200376, 200376) &&
        integer(v[2], 1),
    )
  )
    throw invalid();
  return value as unknown as ExplorationCells;
}

async function read(path: string, signal: AbortSignal) {
  const response = await fetch(path, { signal, cache: 'no-store' });
  if (response.status === 401) throw new FootprintError('登录已过期', 401);
  if (response.status === 404) throw new FootprintError('没有找到该范围的足迹', 404);
  if (!response.ok) throw new FootprintError('无法读取城市探索，请重试', response.status);
  const body: unknown = await response.json();
  if (!object(body) || body.error !== null) throw invalid();
  return body.data;
}

export const readCatalog = async (offset: number, signal: AbortSignal) =>
  parseCatalog(await read(`${root}/cities?limit=20&offset=${offset}`, signal));

export const readDetail = async (scope: Scope, placeCode: string, year: number, signal: AbortSignal) =>
  parseDetail(await read(`${root}/${scope}/${encodeURIComponent(placeCode)}?year=${year}`, signal));

export const readCells = async (
  scope: Scope,
  placeCode: string,
  year: number,
  layer: Layer,
  viewport: Viewport | null,
  signal: AbortSignal,
) => {
  const query = new URLSearchParams({ year: String(year), layer, zoom: String(viewport?.zoom ?? 5) });
  if (viewport) query.set('bbox', viewport.bounds.join(','));
  return parseCells(await read(`${root}/${scope}/${encodeURIComponent(placeCode)}/cells?${query}`, signal));
};
