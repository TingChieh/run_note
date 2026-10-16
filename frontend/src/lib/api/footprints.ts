import type { GeoJSONSourceSpecification } from 'maplibre-gl';
type Collection = Exclude<GeoJSONSourceSpecification['data'], string>;
type Feature = Collection extends { features: (infer F)[] } ? F : never;
type Geometry = Feature['geometry'];
export interface Selection { year: number; from: string; to: string; mode: 'tracks' | 'heatmap'; filter: 'year' | 'range' }
export interface Footprints { type: 'FeatureCollection'; features: Feature[]; mode: Selection['mode']; date_from: string; date_to: string; activity_count: number; visible_activity_count: number; unsupported_segment_count: number; grid_size_m: number; grid_crs: string; count_basis: string; max_count: number }
export type FootprintsAll = Omit<Footprints, 'date_from' | 'date_to'> & { scope: 'all' };
export type FootprintCollection = Footprints | FootprintsAll;
export interface FootprintSnapshot { status: 'pending' | 'ready' | 'failed'; generated_at: string | null; refreshing: boolean; refresh_failed: boolean; result: FootprintsAll | null }
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
function parseCollection(v: unknown, all: boolean): FootprintCollection {
  const invalid: () => never = () => { throw new FootprintError('足迹服务返回了无效响应，请重试',502); };
  if (!object(v) || v.type!=='FeatureCollection' || !Array.isArray(v.features) || !['tracks','heatmap'].includes(String(v.mode)) || v.grid_size_m!==100 || v.grid_crs!=='EPSG:3857' || v.count_basis!=='distinct_activity_per_cell' || (all ? v.scope!=='all' : !validDate(String(v.date_from)) || !validDate(String(v.date_to)))) invalid();
  for (const key of ['activity_count','visible_activity_count','unsupported_segment_count','max_count']) if (!Number.isInteger(v[key]) || (v[key] as number)<0) invalid();
  if ((v.visible_activity_count as number)>(v.activity_count as number)) invalid();
  for (const f of v.features as unknown[]) {
    if (!object(f) || f.type!=='Feature' || !geometry(f.geometry) || !object(f.properties)) invalid();
    const p=f.properties as Record<string,unknown>;
    if (v.mode==='heatmap') { if (!object(f.geometry) || f.geometry.type!=='Polygon' || !Number.isInteger(p.count) || (p.count as number)<1 || (p.count as number)>(v.max_count as number) || !Number.isInteger(p.i) || !Number.isInteger(p.j)) invalid(); }
    else if (typeof p.activity_id!=='string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(p.activity_id) || typeof p.title!=='string' || !validDate(String(p.activity_date)) || !Number.isInteger(p.segment_index) || (p.segment_index as number)<0) invalid();
  }
  return v as unknown as FootprintCollection;
}
export function parseFootprints(v: unknown): Footprints { return parseCollection(v, false) as Footprints; }
export function parseFootprintSnapshot(v: unknown): FootprintSnapshot {
  const invalid: () => never = () => { throw new FootprintError('足迹服务返回了无效响应，请重试',502); };
  if (!object(v) || !['pending','ready','failed'].includes(String(v.status)) || typeof v.refreshing!=='boolean' || (v.refresh_failed!==undefined && typeof v.refresh_failed!=='boolean')) invalid();
  const generated = v.generated_at;
  if (generated!==null && (typeof generated!=='string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(generated) || !Number.isFinite(Date.parse(generated)))) invalid();
  if (v.status==='ready') {
    if (generated===null || v.result===null) invalid();
    return {status:'ready',generated_at:generated as string,refreshing:v.refreshing as boolean,refresh_failed:v.refresh_failed===true,result:parseCollection(v.result,true) as FootprintsAll};
  }
  if (v.result!==null) invalid();
  return {status:v.status as 'pending'|'failed',generated_at:generated as string|null,refreshing:v.refreshing as boolean,refresh_failed:v.refresh_failed===true,result:null};
}
export async function readAllFootprints(mode: Selection['mode'], signal: AbortSignal, fetcher: typeof fetch=fetch): Promise<FootprintSnapshot> {
  const response=await fetcher(`/api/v1/showcase/footprints/all?${new URLSearchParams({mode})}`,{cache:'no-store',credentials:'same-origin',signal});
  if (response.status===401) throw new FootprintError('登录已过期',401);
  let body: unknown;
  try { body=await response.json(); } catch { throw new FootprintError('无法读取足迹，请稍后重试',response.ok?502:response.status); }
  if (!object(body)) throw new FootprintError('足迹服务返回了无效响应，请重试',502);
  if (!response.ok || body.error) throw new FootprintError(object(body.error) && typeof body.error.message==='string'?body.error.message:'无法读取足迹，请稍后重试',response.status);
  const snapshot=parseFootprintSnapshot(body.data);
  if (snapshot.result && snapshot.result.mode!==mode) throw new FootprintError('足迹服务返回了无效响应，请重试',502);
  return snapshot;
}
export async function readFootprints(s: Selection, signal: AbortSignal, fetcher: typeof fetch=fetch): Promise<Footprints> {
  const q=new URLSearchParams({...footprintRange(s),mode:s.mode});
  const response=await fetcher(`/api/v1/showcase/footprints?${q}`,{cache:'no-store',credentials:'same-origin',signal});
  const body=await response.json();
  if (!response.ok || body.error) throw new FootprintError(body.error?.message??'无法读取足迹，请稍后重试',response.status);
  return parseFootprints(body.data);
}
// Traverse in place. Bounds/anchor consumers do not need a flattened copy of
// every coordinate; a 100k-point collection should allocate only its result.
export function forEachCoordinate(g: Geometry, visit: (point: [number,number]) => void): void {
  if(g.type==='GeometryCollection') { for(const child of g.geometries)forEachCoordinate(child,visit); return; }
  const walk=(v: unknown): void => {
    if(!Array.isArray(v))return;
    if(typeof v[0]==='number')visit(v as [number,number]);
    else for(const child of v)walk(child);
  };
  walk(g.coordinates);
}
export function coordinates(g: Geometry): [number,number][] {
  const points: [number,number][]=[];
  forEachCoordinate(g,p=>points.push(p));
  return points;
}
export function geometryBounds(geometries: Geometry[]): [[number,number],[number,number]] | null {
  let bounds: [[number,number],[number,number]] | null=null;
  for(const g of geometries)forEachCoordinate(g,([x,y])=>{
    if(!bounds)bounds=[[x,y],[x,y]];
    else { bounds[0][0]=Math.min(bounds[0][0],x); bounds[0][1]=Math.min(bounds[0][1],y); bounds[1][0]=Math.max(bounds[1][0],x); bounds[1][1]=Math.max(bounds[1][1],y); }
  });
  return bounds;
}

// Only display coordinates change. Server grid keys/counts retain their fixed CRS.
// Move whole pieces to the world copy nearest the first piece. Reuse geometry
// when its offset is zero; shifted pieces always get new coordinate arrays.
export function displayFootprints<T extends FootprintCollection>(data: T): T {
  const first=(value: unknown): number | undefined => Array.isArray(value)
    ? typeof value[0]==='number' ? value[0] : first(value[0]) : undefined;
  const firstLongitude=(g: Geometry): number | undefined => g.type==='GeometryCollection'
    ? g.geometries.map(firstLongitude).find((v: number | undefined)=>v!==undefined) : first(g.coordinates);
  const anchor=data.features.map(f=>firstLongitude(f.geometry)).find(v=>v!==undefined)??0;
  const move=(v: unknown, offset: number): unknown => Array.isArray(v)
    ? typeof v[0]==='number' ? [v[0]+offset,v[1]] : v.map(c=>move(c,offset)) : v;
  const piece=(v: unknown): unknown => {
    const offset=Math.round((anchor-(first(v)??anchor))/360)*360;
    return offset===0?v:move(v,offset);
  };
  const display=(g: Geometry): Geometry => {
    if(g.type==='GeometryCollection')return {...g,geometries:g.geometries.map(display)};
    if(g.type==='MultiLineString' || g.type==='MultiPoint' || g.type==='MultiPolygon') {
      const shifted=g.coordinates.map(piece);
      return shifted.every((c: unknown,i: number)=>c===g.coordinates[i])?g:{...g,coordinates:shifted} as Geometry;
    }
    const shifted=piece(g.coordinates);
    return shifted===g.coordinates?g:{...g,coordinates:shifted} as Geometry;
  };
  return {...data,features:data.features.map(f=>({...f,geometry:display(f.geometry)}))};
}
