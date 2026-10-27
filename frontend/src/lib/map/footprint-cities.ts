import type { FootprintCollection } from '#lib/api/footprints.ts';
import { geometryBounds } from '#lib/api/footprints.ts';

type Point = [number, number];
type Bounds = [Point, Point];
type Polygon = Point[][];
type Geometry = FootprintCollection['features'][number]['geometry'];
export interface CityRegion { code: string; name: string; bounds: Bounds; polygons: Polygon[] }
export interface FootprintCity { code: string; name: string; bounds: Bounds }
export interface CityLocations { cities: FootprintCity[]; unlocatedBounds: Bounds | null }

function overlaps(a: Bounds, b: Bounds): boolean {
  return a[0][0] <= b[1][0] && a[1][0] >= b[0][0] && a[0][1] <= b[1][1] && a[1][1] >= b[0][1];
}
function merge(a: Bounds | null, b: Bounds): Bounds {
  return a ? [[Math.min(a[0][0],b[0][0]),Math.min(a[0][1],b[0][1])],[Math.max(a[1][0],b[1][0]),Math.max(a[1][1],b[1][1])]] : b;
}
function cross(a: Point, b: Point, p: Point): number {
  return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
}
function onSegment(a: Point, b: Point, p: Point): boolean {
  return Math.abs(cross(a,b,p)) < 1e-10 && p[0]>=Math.min(a[0],b[0])-1e-10 && p[0]<=Math.max(a[0],b[0])+1e-10 && p[1]>=Math.min(a[1],b[1])-1e-10 && p[1]<=Math.max(a[1],b[1])+1e-10;
}
function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  if(!overlaps([[Math.min(a[0],b[0]),Math.min(a[1],b[1])],[Math.max(a[0],b[0]),Math.max(a[1],b[1])]],[[Math.min(c[0],d[0]),Math.min(c[1],d[1])],[Math.max(c[0],d[0]),Math.max(c[1],d[1])]]))return false;
  return cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0 || onSegment(a,b,c) || onSegment(a,b,d) || onSegment(c,d,a) || onSegment(c,d,b);
}
function inRing(point: Point, ring: Point[]): boolean {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if(onSegment(a,b,point))return true;
    if((a[1]>point[1])!==(b[1]>point[1]) && point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
function inPolygon(point: Point, polygon: Polygon): boolean {
  return inRing(point,polygon[0]) && !polygon.slice(1).some(ring=>inRing(point,ring));
}
const polygonBounds = new WeakMap<Polygon, Bounds>();
function boundsOf(polygon: Polygon): Bounds {
  let cached = polygonBounds.get(polygon);
  if (!cached) {
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for (const [x,y] of polygon[0]) { if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
    cached = [[minX,minY],[maxX,maxY]];
    polygonBounds.set(polygon, cached);
  }
  return cached;
}
function lineBounds(line: Point[]): Bounds {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const [x,y] of line) { if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
  return [[minX,minY],[maxX,maxY]];
}
// Exact, only cheaper: polygons whose outline box misses the line's box cannot touch it, and only ring edges
// inside the line's box can cross it, so the n x m edge comparison shrinks to n x (nearby edges).
function touchesLine(line: Point[], region: CityRegion): boolean {
  const box = lineBounds(line);
  for (const polygon of region.polygons) {
    if (!overlaps(box, boundsOf(polygon))) continue;
    const outline = boundsOf(polygon);
    for (const point of line) {
      if (point[0]<outline[0][0] || point[0]>outline[1][0] || point[1]<outline[0][1] || point[1]>outline[1][1]) continue;
      if (inPolygon(point, polygon)) return true;
    }
  }
  for (const polygon of region.polygons) {
    if (!overlaps(box, boundsOf(polygon))) continue;
    for (const ring of polygon) {
      const edges: [Point, Point][] = [];
      for (let j=1;j<ring.length;j++) {
        const c=ring[j-1], d=ring[j];
        if (Math.max(c[0],d[0])>=box[0][0] && Math.min(c[0],d[0])<=box[1][0] && Math.max(c[1],d[1])>=box[0][1] && Math.min(c[1],d[1])<=box[1][1]) edges.push([c,d]);
      }
      if (!edges.length) continue;
      for (let i=1;i<line.length;i++) {
        const a=line[i-1], b=line[i];
        // Crossing the dateline must never invent a segment through mainland China.
        if (Math.abs(a[0]-b[0])>180) continue;
        for (const [c,d] of edges) if (intersects(a,b,c,d)) return true;
      }
    }
  }
  return false;
}
function touchesPolygon(polygon: Polygon, region: CityRegion): boolean {
  return polygon.some(ring=>touchesLine(ring,region)) || region.polygons.some(city=>inPolygon(city[0][0],polygon));
}
function touches(geometry: Geometry, region: CityRegion): boolean {
  switch(geometry.type){
    case 'Point': return region.polygons.some(polygon=>inPolygon(geometry.coordinates as Point,polygon));
    case 'MultiPoint': return (geometry.coordinates as Point[]).some(point=>region.polygons.some(polygon=>inPolygon(point,polygon)));
    case 'LineString': return touchesLine(geometry.coordinates as Point[],region);
    case 'MultiLineString': return (geometry.coordinates as Point[][]).some(line=>touchesLine(line,region));
    case 'Polygon': return touchesPolygon(geometry.coordinates as Polygon,region);
    case 'MultiPolygon': return (geometry.coordinates as Polygon[]).some(polygon=>touchesPolygon(polygon,region));
    case 'GeometryCollection': return geometry.geometries.some((child:Geometry)=>touches(child,region));
  }
  return false;
}

/** Display estimates only. Coordinates and authoritative activity/heat counts remain untouched. */
export function locateFootprintCities(geometries: Geometry[], regions: CityRegion[]): CityLocations {
  const found=new Map<string,FootprintCity>();let unlocatedBounds: Bounds|null=null;
  for(const geometry of geometries){
    const bounds=geometryBounds([geometry]);if(!bounds)continue;
    let located=false;
    for(const region of regions){
      if(!overlaps(bounds,region.bounds) || !touches(geometry,region))continue;
      located=true;
      // Fit the part of this record within the city's extent, rather than an arbitrary city centre.
      const visible:Bounds=[[Math.max(bounds[0][0],region.bounds[0][0]),Math.max(bounds[0][1],region.bounds[0][1])],[Math.min(bounds[1][0],region.bounds[1][0]),Math.min(bounds[1][1],region.bounds[1][1])]];
      found.set(region.code,{code:region.code,name:region.name,bounds:merge(found.get(region.code)?.bounds??null,visible)});
    }
    if(!located)unlocatedBounds=merge(unlocatedBounds,bounds);
  }
  return {cities:[...found.values()].sort((a,b)=>a.code.localeCompare(b.code)),unlocatedBounds};
}
