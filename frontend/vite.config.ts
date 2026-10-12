import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), '');
  const target = env.INTERNAL_API_BASE_URL ?? 'http://127.0.0.1:8000';
  const url = new URL(target);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('INTERNAL_API_BASE_URL must be an HTTP(S) origin without credentials');
  }
  return {
    plugins: [tailwindcss(), sveltekit({ adapter: adapter(), preprocess: vitePreprocess() })],
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: url.origin } }
    }
  };
});
