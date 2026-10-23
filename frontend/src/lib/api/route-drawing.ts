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

/** An abstract local drawing: no basemap requests, coordinates, endpoints or labels. */
export function routeDrawing(route: Route, width = 360, height = 220) {
  const project = fitRoute(route, width, height);
  const paths: string[] = [], points: [number,number][] = [];
  for (const f of route.features) {
    if (f.geometry.type === 'Point') points.push(project(f.geometry.coordinates));
    else {
      // Reduce redundant display vertices to avoid megabyte SVGs, preserving each segment.
      let previous: [number,number] | null = null;
      const path: string[] = [];
      f.geometry.coordinates.forEach((p,i,all) => {
        const [x,y] = project(p);
        if (previous && Math.hypot(x-previous[0],y-previous[1]) < .6 && i !== all.length-1) return;
        path.push(`${path.length ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`); previous = [x,y];
      });
      paths.push(path.join(' '));
    }
  }
  return { paths, points };
}
