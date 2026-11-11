// SvelteKit's client start waits for the root error page module (node 1) before it hydrates, but SSR
// only preloads the matched branch, so that file used to be requested one round trip after the app
// entry ran, delaying every page's first data read. The built server node lists its client imports;
// the ones a page lacks are added as modulepreload links.

let cached: Promise<string[]> | undefined;

/** Client imports of the built root error node; empty outside a build (dev, tests). */
export function rootErrorImports(): Promise<string[]> {
  // Relative to the built server chunk: build/server/{chunks,entries}/*.js → build/server/nodes/1.js.
  cached ??= import(/* @vite-ignore */ new URL('../nodes/1.js', import.meta.url).href).then(nodeImports, () => []);
  return cached;
}

export function nodeImports(node: unknown): string[] {
  const imports = (node as { imports?: unknown } | null)?.imports;
  if (!Array.isArray(imports)) return [];
  return imports.filter(
    (path): path is string => typeof path === 'string' && /^_app\/immutable\/[\w./-]+\.js$/.test(path),
  );
}

/** Adds a modulepreload link before `</head>` for each path the chunk does not already reference. */
export function addModulePreloads(html: string, paths: string[]): string {
  const links = paths
    .filter((path) => !html.includes(path))
    .map((path) => `<link href="/${path}" rel="modulepreload">`)
    .join('');
  return links ? html.replace('</head>', `${links}</head>`) : html;
}
