import type { GeoJSONSourceSpecification } from 'maplibre-gl';
type Collection = Exclude<GeoJSONSourceSpecification['data'], string>;
type Feature = Collection extends { features: (infer F)[] } ? F : never;
type Geometry = Feature['geometry'];
export interface Selection { year: number; from: string; to: string; mode: 'tracks' | 'heatmap'; filter: 'year' | 'range' }
export interface Footprints { type: 'FeatureCollection'; features: Feature[]; mode: Selection['mode']; date_from: string; date_to: string; activity_count: number; visible_activity_count: number; unsupported_segment_count: number; grid_size_m: number; grid_crs: string; count_basis: string; max_count: number }
export class FootprintError extends Error { constructor(message: string, public status = 422) { super(message); } }
const validDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
export function footprintRange(s: Selection) {
  const from = s.filter === 'year' ? `${s.year}-01-01` : s.from;
  const to = s.filter === 'year' ? `${s.year}-12-31` : s.to;
  if (!validDate(from) || !validDate(to) || from > to || from < '1900-01-01' || to > '2100-12-31') throw new FootprintError('请选择有效的起止日期（1900–2100 年）');
  const end = new Date(to); end.setUTCDate(end.getUTCDate()+1);
  return { date_from: from, date_to: end.toISOString().slice(0,10) };
}
export function footprintSelection(q: URLSearchParams, defaultYear: number): Selection {
  const raw = q.get('year') ?? '', year = /^\d{4}$/.test(raw) && Number(raw)>=1900 && Number(raw)<=2100 ? Number(raw) : defaultYear;
  const s: Selection = {year,from:q.get('from')??`${year}-01-01`,to:q.get('to')??`${year}-12-31`,mode:q.get('mode')==='heatmap'?'heatmap':'tracks',filter:q.get('filter')==='range'?'range':'year'};
  try { footprintRange(s); } catch { s.filter='year'; s.from=`${year}-01-01`; s.to=`${year}-12-31`; }
  return s;
}
export function footprintQuery(s: Selection) { return new URLSearchParams({year:String(s.year),from:s.from,to:s.to,mode:s.mode,filter:s.filter}); }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v==='object' && !Array.isArray(v);
function geometry(v: unknown): boolean {
  if (!object(v)) return false;
  if (v.type==='GeometryCollection') return Array.isArray(v.geometries) && v.geometries.length>0 && v.geometries.every(geometry);
  const coordinate = (c: unknown): boolean => Array.isArray(c) && c.length===2 && c.every(x=>typeof x==='number' && Number.isFinite(x)) && Math.abs(c[0])<=181 && Math.abs(c[1])<=86;
  const line = (c: unknown): boolean => Array.isArray(c) && c.length>=2 && c.every(coordinate);
  const ring = (c: unknown): boolean => line(c) && (c as unknown[]).length>=4;
  if (v.type==='Point') return coordinate(v.coordinates);
  if (v.type==='MultiPoint') return Array.isArray(v.coordinates) && v.coordinates.length>0 && v.coordinates.every(coordinate);
  if (v.type==='LineString') return line(v.coordinates);
  if (v.type==='MultiLineString') return Array.isArray(v.coordinates) && v.coordinates.length>0 && v.coordinates.every(line);
  if (v.type==='Polygon') return Array.isArray(v.coordinates) && v.coordinates.length>0 && v.coordinates.every(ring);
  return false;
}
export function parseFootprints(v: unknown): Footprints {
  const invalid: () => never = () => { throw new FootprintError('足迹服务返回了无效响应，请重试',502); };
  if (!object(v) || v.type!=='FeatureCollection' || !Array.isArray(v.features) || !['tracks','heatmap'].includes(String(v.mode)) || v.grid_size_m!==100 || v.grid_crs!=='EPSG:3857' || v.count_basis!=='distinct_activity_per_cell' || !validDate(String(v.date_from)) || !validDate(String(v.date_to))) invalid();
  for (const key of ['activity_count','visible_activity_count','unsupported_segment_count','max_count']) if (!Number.isInteger(v[key]) || (v[key] as number)<0) invalid();
  if ((v.visible_activity_count as number)>(v.activity_count as number)) invalid();
  for (const f of v.features as unknown[]) {
    if (!object(f) || f.type!=='Feature' || !geometry(f.geometry) || !object(f.properties)) invalid();
    const p=f.properties as Record<string,unknown>;
    if (v.mode==='heatmap') { if (!object(f.geometry) || f.geometry.type!=='Polygon' || !Number.isInteger(p.count) || (p.count as number)<1 || (p.count as number)>(v.max_count as number) || !Number.isInteger(p.i) || !Number.isInteger(p.j)) invalid(); }
    else if (typeof p.activity_id!=='string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(p.activity_id) || typeof p.title!=='string' || !validDate(String(p.activity_date)) || !Number.isInteger(p.segment_index) || (p.segment_index as number)<0) invalid();
  }
  return v as unknown as Footprints;
}
export async function readFootprints(s: Selection, signal: AbortSignal, fetcher: typeof fetch=fetch): Promise<Footprints> {
  const q=new URLSearchParams({...footprintRange(s),mode:s.mode});
  const response=await fetcher(`/api/v1/footprints?${q}`,{cache:'no-store',credentials:'same-origin',signal});
  const body=await response.json();
  if (!response.ok || body.error) throw new FootprintError(body.error?.message??'无法读取足迹，请稍后重试',response.status);
  return parseFootprints(body.data);
}
export function coordinates(g: Geometry): [number,number][] {
  if(g.type==='GeometryCollection') return g.geometries.flatMap(coordinates);
  const flatten=(v: unknown): [number,number][] => Array.isArray(v) && typeof v[0]==='number' ? [v as [number,number]] : Array.isArray(v) ? v.flatMap(flatten) : [];
  return flatten(g.coordinates);
}

// Only display coordinates change. Server grid keys/counts retain their fixed CRS.
// Each dumped line/grid is small; move whole pieces to the world copy nearest
// the first piece, so a short route at ±180 does not fit a full-world viewport.
export function displayFootprints(data: Footprints): Footprints {
  const anchor=data.features.flatMap(f=>coordinates(f.geometry))[0]?.[0]??0;
  const move=(v: unknown, offset: number): unknown => Array.isArray(v)
    ? typeof v[0]==='number' ? [v[0]+offset,v[1]] : v.map(c=>move(c,offset)) : v;
  const piece=(v: unknown): unknown => {
    const first=(value: unknown): number => Array.isArray(value) ? typeof value[0]==='number' ? value[0] : first(value[0]) : anchor;
    return move(v,Math.round((anchor-first(v))/360)*360);
  };
  const display=(g: Geometry): Geometry => {
    if(g.type==='GeometryCollection')return {...g,geometries:g.geometries.map(display)};
    if(g.type==='MultiLineString' || g.type==='MultiPoint' || g.type==='MultiPolygon')return {...g,coordinates:g.coordinates.map(piece)} as Geometry;
    return {...g,coordinates:piece(g.coordinates)} as Geometry;
  };
  return {...data,features:data.features.map(f=>({...f,geometry:display(f.geometry)}))};
}
