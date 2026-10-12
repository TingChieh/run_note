import { defineEnvVars } from '@sveltejs/kit/env';
export const variables = defineEnvVars({
  INTERNAL_API_BASE_URL: {
    public: false,
    schema: (value: string | undefined) => {
      const url = new URL(value ?? 'http://127.0.0.1:8000');
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('INTERNAL_API_BASE_URL must be an HTTP(S) origin without credentials');
      return url.origin;
    }
  }
});
