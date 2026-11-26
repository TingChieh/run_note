import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  define: {
    __RUNNOTE_MOBILE_BUNDLE__: JSON.stringify(true),
    __RUNNOTE_APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter({
        pages: '../android/public',
        assets: '../android/public',
        fallback: 'index.html',
        precompress: false,
        strict: false,
      }),
      preprocess: vitePreprocess(),
      files: {
        routes: 'src/mobile-routes',
        appTemplate: 'src/app.mobile.html',
        hooks: {
          client: 'src/hooks.mobile.client.ts',
          server: 'src/hooks.mobile.server.ts',
        },
      },
      outDir: '.svelte-kit-mobile',
      env: { dir: '..' },
    }),
  ],
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
});
