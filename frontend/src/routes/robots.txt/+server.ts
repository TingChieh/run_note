import type { RequestHandler } from './$types';
import { robotsTxt } from '#lib/seo.ts';

export const GET: RequestHandler = ({ url }) => new Response(robotsTxt(url.origin), {
  headers: { 'Content-Type': 'text/plain; charset=utf-8' },
});
