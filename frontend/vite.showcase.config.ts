import tailwindcss from '@tailwindcss/vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Independent fixture entry: never registered in the production SvelteKit router.
export default defineConfig({
  root: 'tests/fixtures/ui-showcase',
  publicDir: false,
  // Sharing the app's optimizer cache can invalidate running SvelteKit dev imports.
  cacheDir: fileURLToPath(new URL('./node_modules/.vite-showcase', import.meta.url)),
  plugins: [tailwindcss(), svelte({ preprocess: vitePreprocess() })],
  server: { host: '127.0.0.1', port: 5193, strictPort: true },
  build: { outDir: '../../../dist/ui-showcase', emptyOutDir: true }
});
