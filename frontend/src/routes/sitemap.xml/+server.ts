import type { RequestHandler } from './$types';
import { sitemapXml } from '#lib/seo.ts';

export const GET: RequestHandler = ({ url }) => new Response(sitemapXml(url.origin), {
  headers: { 'Content-Type': 'application/xml; charset=utf-8' },
});
