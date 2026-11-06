import type { Route } from './activities';

function fitRoute(route: Route, width: number, height: number) {
  const mercator = ([x,y]: [number,number]): [number,number] => [x, Math.log(Math.tan(Math.PI/4 + Math.max(-85,Math.min(85,y))*Math.PI/360))*180/Math.PI];
  let left = Infinity, right = -Infinity, top = -Infinity, bottom = Infinity;
  for (const f of route.features) for (const p of f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates) {
    const [x,y] = mercator(p); left = Math.min(left,x); right = Math.max(right,x); top = Math.max(top,y); bottom = Math.min(bottom,y);
  }
  const scale = Math.min((width-32)/Math.max(right-left, .000001), (height-32)/Math.max(top-bottom, .000001));
  return (p: [number,number]): [number,number] => { const [x,y] = mercator(p); return [width/2+(x-(left+right)/2)*scale, height/2-(y-(top+bottom)/2)*scale]; };
}

/** Start and end projected into the same box as `routeDrawing`; only for owner-generated share images. */
export function routeEndpoints(route: Route, width: number, height: number) {
  const project = fitRoute(route, width, height);
  return { start: project(route.start), end: project(route.end) };
}

/** Douglas-Peucker: keeps the endpoints and every vertex that deviates more than `tolerance`. */
function simplify(points: [number,number][], tolerance: number): [number,number][] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length-1] = 1;
  const stack: [number,number][] = [[0, points.length-1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const [ax,ay] = points[first], [bx,by] = points[last];
    const length = Math.hypot(bx-ax, by-ay);
    let far = -1, farDistance = tolerance;
    for (let i = first+1; i < last; i++) {
      const [x,y] = points[i];
      const d = length === 0 ? Math.hypot(x-ax, y-ay) : Math.abs((bx-ax)*(ay-y) - (ax-x)*(by-ay)) / length;
      if (d > farDistance) { far = i; farDistance = d; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([first, far], [far, last]); }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * An abstract local drawing: no basemap requests, coordinates, endpoints or labels.
 * `tolerance` (px of the drawing box) additionally simplifies each segment and `digits` rounds the
 * output; thumbnails use both because their SVG is inlined into server-rendered HTML.
 */
export function routeDrawing(route: Route, width = 360, height = 220, { tolerance = 0, digits = 2 }: { tolerance?: number; digits?: number } = {}) {
  const project = fitRoute(route, width, height);
  const paths: string[] = [], points: [number,number][] = [];
  for (const f of route.features) {
    if (f.geometry.type === 'Point') points.push(project(f.geometry.coordinates));
    else {
      // Reduce redundant display vertices to avoid megabyte SVGs, preserving each segment.
      let previous: [number,number] | null = null;
      let kept: [number,number][] = [];
      f.geometry.coordinates.forEach((p,i,all) => {
        const [x,y] = project(p);
        if (previous && Math.hypot(x-previous[0],y-previous[1]) < .6 && i !== all.length-1) return;
        kept.push([x,y]); previous = [x,y];
      });
      if (tolerance > 0) kept = simplify(kept, tolerance);
      paths.push(kept.map(([x,y], i) => `${i ? 'L' : 'M'}${x.toFixed(digits)},${y.toFixed(digits)}`).join(' '));
    }
  }
  return { paths, points };
}
